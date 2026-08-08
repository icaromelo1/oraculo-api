import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { pareceBinario } from '../capabilities/codigo/binario';
import { OraculoConfig } from '../config/config.service';
import { IndexacaoService } from '../corpus/indexacao.service';
import { extrairTitulo } from '../corpus/procedencia';
import { SecurityService } from '../security/security.service';
import { CriarNotaDto } from './dto/criar-nota.dto';
import { extrairTextoDePdf, mensagemDoErro, pareceDocumentoPdf } from './pdf';
import {
  gerarSlug,
  proximoSlug,
  slugDoNomeDeArquivo,
  slugSeguro,
} from './slug';

export interface NotaListada {
  slug: string;
  titulo: string;
  caminho: string;
  bytes: number;
  atualizadaEm: Date;
}

export const TAMANHO_MAXIMO_BYTES = 2 * 1024 * 1024;
export const MAXIMO_DE_ARQUIVOS_POR_LOTE = 20;
const EXTENSOES_ACEITAS = ['.md', '.txt', '.pdf'];

const EXTENSAO_GRAVADA = '.md';
const MAX_TENTATIVAS_DE_SLUG = 500;
const HEADING = /^#{1,6}\s+\S/;
const BYTE_NULO = String.fromCharCode(0);

export interface ArquivoEnviado {
  originalname: string;
  buffer: Buffer;
  mimetype?: string;
  size?: number;
}

export interface NotaGravada {
  id: string | null;
  slug: string;
  caminho: string;
  trechosIndexados: number;
}

export interface ItemDoLote {
  arquivo: string;
  aceito: boolean;
  motivo: string | null;
  id: string | null;
  slug: string | null;
  caminho: string | null;
  trechosIndexados: number;
}

export interface LoteEnviado {
  total: number;
  aceitos: number;
  recusados: number;
  itens: ItemDoLote[];
}

@Injectable()
export class ConhecimentoService {
  private readonly logger = new Logger(ConhecimentoService.name);

  constructor(
    private readonly config: OraculoConfig,
    private readonly indexacao: IndexacaoService,
    private readonly seguranca: SecurityService,
  ) {}

  async criarNota(
    pedido: CriarNotaDto,
    usuarioId?: string | null,
  ): Promise<NotaGravada> {
    const titulo = (pedido.titulo ?? '').trim();
    const conteudo = pedido.conteudo ?? '';

    if (!titulo) {
      throw new BadRequestException('titulo é obrigatório');
    }

    if (!conteudo.trim()) {
      throw new BadRequestException('conteudo é obrigatório');
    }

    if (Buffer.byteLength(conteudo, 'utf-8') > TAMANHO_MAXIMO_BYTES) {
      throw new PayloadTooLargeException(
        'conteudo passou do teto de 2 MB por nota',
      );
    }

    return this.gravar({
      slugBase: gerarSlug(titulo),
      conteudo: this.corpoDaNota(titulo, conteudo),
      acao: 'conhecimento.nota.criar',
      descricao: `nota "${titulo}"`,
      usuarioId,
    });
  }

  async enviarArquivos(
    arquivos: readonly ArquivoEnviado[] | undefined,
    usuarioId?: string | null,
  ): Promise<LoteEnviado> {
    const lote = arquivos ?? [];

    if (lote.length === 0) {
      throw new BadRequestException(
        'nenhum arquivo recebido — envie multipart/form-data com o campo "arquivo"',
      );
    }

    if (lote.length > MAXIMO_DE_ARQUIVOS_POR_LOTE) {
      throw new PayloadTooLargeException(
        `o lote traz ${lote.length} arquivos — o máximo é ${MAXIMO_DE_ARQUIVOS_POR_LOTE} por envio`,
      );
    }

    const itens: ItemDoLote[] = [];

    for (const arquivo of lote) {
      itens.push(await this.tentarArquivo(arquivo, usuarioId));
    }

    const aceitos = itens.filter((item) => item.aceito).length;

    return {
      total: itens.length,
      aceitos,
      recusados: itens.length - aceitos,
      itens,
    };
  }

  async enviarArquivo(
    arquivo: ArquivoEnviado | undefined,
    usuarioId?: string | null,
  ): Promise<NotaGravada> {
    const buffer = arquivo?.buffer;

    if (!arquivo || !Buffer.isBuffer(buffer)) {
      throw new BadRequestException(
        'nenhum arquivo recebido — envie multipart/form-data com o campo "arquivo"',
      );
    }

    const nome = (arquivo.originalname ?? '').trim();
    const extensao = extname(nome).toLowerCase();
    const tamanho = arquivo.size ?? buffer.length;

    if (buffer.length === 0) {
      throw new BadRequestException(`"${nome}" está vazio`);
    }

    if (
      tamanho > TAMANHO_MAXIMO_BYTES ||
      buffer.length > TAMANHO_MAXIMO_BYTES
    ) {
      throw new PayloadTooLargeException(
        `"${nome}" passou do teto de 2 MB por arquivo`,
      );
    }

    if (!EXTENSOES_ACEITAS.includes(extensao)) {
      throw new UnsupportedMediaTypeException(
        `"${nome}" não é aceito — só ${EXTENSOES_ACEITAS.join(', ')}`,
      );
    }

    if (pareceDocumentoPdf(nome, arquivo.mimetype, buffer)) {
      return this.gravarPdf(nome, buffer, usuarioId);
    }

    if (pareceBinario(buffer) || buffer.includes(0)) {
      throw new UnsupportedMediaTypeException(
        `"${nome}" tem conteúdo binário (byte nulo), não texto — a extensão não decide, o conteúdo decide`,
      );
    }

    if (!this.utf8Valido(buffer)) {
      throw new UnsupportedMediaTypeException(
        `"${nome}" não é UTF-8 válido — converta o arquivo antes de enviar`,
      );
    }

    return this.gravar({
      slugBase: slugDoNomeDeArquivo(nome),
      conteudo: buffer.toString('utf-8'),
      acao: 'conhecimento.arquivo.enviar',
      descricao: `arquivo "${nome}"`,
      usuarioId,
    });
  }

  async editarNota(
    slug: string,
    conteudo: string,
    usuarioId?: string | null,
  ): Promise<NotaGravada> {
    const caminho = this.caminhoDaNota(slug);
    const texto = conteudo ?? '';

    if (!texto.trim()) {
      throw new BadRequestException('conteudo é obrigatório');
    }

    if (Buffer.byteLength(texto, 'utf-8') > TAMANHO_MAXIMO_BYTES) {
      throw new PayloadTooLargeException(
        'conteudo passou do teto de 2 MB por nota',
      );
    }

    if (!(await this.existe(caminho))) {
      throw new NotFoundException(`nota "${slug}" não existe`);
    }

    await writeFile(caminho, texto, 'utf-8');

    const indexado = await this.indexar(caminho);

    await this.auditar(
      usuarioId,
      'conhecimento.nota.editar',
      { slug, caminho },
      `nota "${slug}" regravada em ${caminho} — ${indexado.trechos} trecho(s) reindexado(s)`,
    );

    return {
      id: indexado.id,
      slug,
      caminho,
      trechosIndexados: indexado.trechos,
    };
  }

  async removerNota(slug: string, usuarioId?: string | null): Promise<void> {
    const caminho = this.caminhoDaNota(slug);
    const existeNoDisco = await this.existe(caminho);
    const removidoDoIndice = await this.indexacao.removerArquivo(caminho);

    if (!existeNoDisco && !removidoDoIndice) {
      throw new NotFoundException(`nota "${slug}" não existe`);
    }

    if (existeNoDisco) {
      await rm(caminho, { force: true });
    }

    await this.auditar(
      usuarioId,
      'conhecimento.nota.remover',
      { slug, caminho },
      `nota "${slug}" removida do disco e do índice`,
    );
  }

  async listarNotas(): Promise<NotaListada[]> {
    const diretorio = this.diretorio();

    let nomes: string[];

    try {
      nomes = await readdir(diretorio);
    } catch {
      return [];
    }

    const notas = await Promise.all(
      nomes
        .filter((nome) => nome.toLowerCase().endsWith('.md'))
        .map(async (nome) => {
          const caminho = join(diretorio, nome);

          try {
            const [informacao, conteudo] = await Promise.all([
              stat(caminho),
              readFile(caminho, 'utf-8'),
            ]);

            return {
              slug: nome.replace(/\.md$/i, ''),
              titulo: extrairTitulo(caminho, conteudo),
              caminho,
              bytes: informacao.size,
              atualizadaEm: informacao.mtime,
            };
          } catch {
            return null;
          }
        }),
    );

    return notas
      .filter((nota): nota is NotaListada => nota !== null)
      .sort((a, b) => b.atualizadaEm.getTime() - a.atualizadaEm.getTime());
  }

  private async tentarArquivo(
    arquivo: ArquivoEnviado | undefined,
    usuarioId?: string | null,
  ): Promise<ItemDoLote> {
    const nome = (arquivo?.originalname ?? '').trim() || '(sem nome)';

    try {
      const nota = await this.enviarArquivo(arquivo, usuarioId);

      return {
        arquivo: nome,
        aceito: true,
        motivo: null,
        id: nota.id,
        slug: nota.slug,
        caminho: nota.caminho,
        trechosIndexados: nota.trechosIndexados,
      };
    } catch (erro) {
      if (!(erro instanceof HttpException)) {
        this.logger.error(
          `falha inesperada ao receber "${nome}": ${mensagemDoErro(erro)}`,
        );
      }

      return {
        arquivo: nome,
        aceito: false,
        motivo: mensagemDoErro(erro),
        id: null,
        slug: null,
        caminho: null,
        trechosIndexados: 0,
      };
    }
  }

  private async gravarPdf(
    nome: string,
    buffer: Buffer,
    usuarioId?: string | null,
  ): Promise<NotaGravada> {
    const extracao = await extrairTextoDePdf(nome, buffer);

    if (!extracao.aceito) {
      throw new UnsupportedMediaTypeException(extracao.motivo);
    }

    const texto = extracao.texto.split(BYTE_NULO).join('');

    if (Buffer.byteLength(texto, 'utf-8') > TAMANHO_MAXIMO_BYTES) {
      throw new PayloadTooLargeException(
        `o texto extraído de "${nome}" passou do teto de 2 MB`,
      );
    }

    return this.gravar({
      slugBase: slugDoNomeDeArquivo(nome),
      conteudo: this.corpoDaNota(tituloDoArquivo(nome), texto),
      acao: 'conhecimento.arquivo.enviar',
      descricao: `PDF "${nome}" (${extracao.paginas} página(s), texto extraído)`,
      usuarioId,
    });
  }

  private async gravar(entrada: {
    slugBase: string;
    conteudo: string;
    acao: string;
    descricao: string;
    usuarioId?: string | null;
  }): Promise<NotaGravada> {
    const diretorio = this.diretorio();

    await mkdir(diretorio, { recursive: true });

    const slug = await this.slugDisponivel(entrada.slugBase);
    const caminho = this.caminhoDaNota(slug);

    await writeFile(caminho, entrada.conteudo, 'utf-8');

    const indexado = await this.indexar(caminho);

    await this.auditar(
      entrada.usuarioId,
      entrada.acao,
      { slug, caminho },
      `${entrada.descricao} gravada em ${caminho} — ${indexado.trechos} trecho(s) indexado(s)`,
    );

    return {
      id: indexado.id,
      slug,
      caminho,
      trechosIndexados: indexado.trechos,
    };
  }

  private async indexar(
    caminho: string,
  ): Promise<{ id: string | null; trechos: number }> {
    try {
      const resultado = await this.indexacao.indexarArquivo(caminho);

      return { id: resultado.documentoId, trechos: resultado.trechos };
    } catch (erro) {
      this.logger.error(
        `arquivo gravado em ${caminho}, mas a indexação falhou — a próxima varredura do corpus o recupera: ${
          erro instanceof Error ? erro.message : String(erro)
        }`,
      );

      return { id: null, trechos: 0 };
    }
  }

  private diretorio(): string {
    const configurado = this.config.corpus.notas;

    if (!configurado) {
      throw new BadRequestException(
        'DIRETORIO_NOTAS não está configurado nesta instalação',
      );
    }

    return resolve(configurado);
  }

  private caminhoDaNota(slug: string): string {
    if (!slugSeguro(slug)) {
      throw new BadRequestException(
        `slug inválido — só letras minúsculas, números e hífen, sem barra nem ".."`,
      );
    }

    const raiz = this.diretorio();
    const caminho = resolve(raiz, `${slug}${EXTENSAO_GRAVADA}`);

    if (dirname(caminho) !== raiz) {
      throw new BadRequestException(
        `slug "${slug}" escaparia do diretório de notas`,
      );
    }

    return caminho;
  }

  private async slugDisponivel(base: string): Promise<string> {
    for (
      let tentativa = 1;
      tentativa <= MAX_TENTATIVAS_DE_SLUG;
      tentativa += 1
    ) {
      const candidato = proximoSlug(base, tentativa);

      if (!(await this.existe(this.caminhoDaNota(candidato)))) {
        return candidato;
      }
    }

    throw new ConflictException(
      `já existem ${MAX_TENTATIVAS_DE_SLUG} notas com o slug "${base}" — mude o título`,
    );
  }

  private async existe(caminho: string): Promise<boolean> {
    try {
      await stat(caminho);

      return true;
    } catch {
      return false;
    }
  }

  private corpoDaNota(titulo: string, conteudo: string): string {
    const primeiraLinha = conteudo
      .split('\n')
      .find((linha) => linha.trim().length > 0);

    if (primeiraLinha && HEADING.test(primeiraLinha.trim())) {
      return conteudo;
    }

    return `# ${titulo}\n\n${conteudo}`;
  }

  private utf8Valido(buffer: Buffer): boolean {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(buffer);

      return true;
    } catch {
      return false;
    }
  }

  private async auditar(
    usuarioId: string | null | undefined,
    acao: string,
    argumento: Record<string, unknown>,
    resultado: string,
  ): Promise<void> {
    await this.seguranca.registrar({
      usuarioId: usuarioId ?? null,
      pergunta: `conhecimento anexado: ${acao}`,
      ferramentas: [{ nome: acao, argumento, status: 'aplicada' }],
      fontes: 0,
      resultado,
      tom: 'configuracao',
      duracaoMs: 0,
      modelo: '(conhecimento)',
    });
  }
}

function tituloDoArquivo(nome: string): string {
  const semDiretorio = basename(nome.replace(/\\/g, '/'));

  return basename(semDiretorio, extname(semDiretorio)) || semDiretorio;
}
