import {
  BadRequestException,
  ConflictException,
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
import { dirname, extname, join, resolve } from 'node:path';
import { pareceBinario } from '../capabilities/codigo/binario';
import { OraculoConfig } from '../config/config.service';
import { IndexacaoService } from '../corpus/indexacao.service';
import { extrairTitulo } from '../corpus/procedencia';
import { SecurityService } from '../security/security.service';
import { CriarNotaDto } from './dto/criar-nota.dto';
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
export const EXTENSOES_ACEITAS = ['.md', '.txt'];

const EXTENSAO_GRAVADA = '.md';
const ASSINATURA_PDF = '%PDF-';
const MAX_TENTATIVAS_DE_SLUG = 500;
const HEADING = /^#{1,6}\s+\S/;

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

    if (this.ehPdf(nome, arquivo.mimetype, buffer)) {
      throw new UnsupportedMediaTypeException(
        'PDF ainda não é suportado pelo Oráculo — converta para .md ou .txt, ou cole o texto como nota',
      );
    }

    if (!EXTENSOES_ACEITAS.includes(extensao)) {
      throw new UnsupportedMediaTypeException(
        `"${nome}" não é aceito — só ${EXTENSOES_ACEITAS.join(' e ')}`,
      );
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

  private ehPdf(
    nome: string,
    mimetype: string | undefined,
    buffer: Buffer,
  ): boolean {
    if (extname(nome).toLowerCase() === '.pdf') return true;
    if (mimetype === 'application/pdf') return true;

    return (
      buffer.subarray(0, ASSINATURA_PDF.length).toString('latin1') ===
      ASSINATURA_PDF
    );
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
