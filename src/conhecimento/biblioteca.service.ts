import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { open, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { Repository } from 'typeorm';
import {
  RaizResolvida,
  resolverRaizes,
} from '../capabilities/codigo/seguranca';
import { OraculoConfig } from '../config/config.service';
import { ConfiguracaoService } from '../config/configuracao.service';
import { resolverCaminhoNasRaizes } from '../config/raiz-permitida';
import { Documento, Trecho } from '../database/entities';
import { lerMapaExibicao, traduzirCaminho } from '../engine/caminho-exibicao';
import type { ListarDocumentosDto } from './dto/listar-documentos.dto';

export const TETO_DE_LEITURA_BYTES = 1024 * 1024;

const PADRAO_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DocumentoResumido {
  id: string;
  caminho: string;
  caminhoReal: string;
  titulo: string;
  fonte: string;
  autoridade: number;
  atualizadoEm: Date;
  editavel: boolean;
  moduloId: string | null;
  descricao: string | null;
}

export interface DocumentoListado extends DocumentoResumido {
  trechos: number;
  bytes: number;
}

export interface PastaDaBiblioteca {
  caminho: string;
  caminhoReal: string;
  documentos: number;
}

export interface ListaDocumentos {
  documentos: DocumentoListado[];
  total: number;
  pagina: number;
  porPagina: number;
}

export interface DocumentoAberto extends DocumentoResumido {
  bytes: number;
  conteudo: string | null;
  truncado: boolean;
  aviso: string | null;
}

interface LeituraEmDisco {
  conteudo: string;
  bytes: number;
  truncado: boolean;
}

@Injectable()
export class BibliotecaService {
  constructor(
    private readonly config: OraculoConfig,
    private readonly configuracao: ConfiguracaoService,
    @InjectRepository(Documento)
    private readonly documentos: Repository<Documento>,
    @InjectRepository(Trecho)
    private readonly trechos: Repository<Trecho>,
  ) {}

  async listar(filtro: ListarDocumentosDto): Promise<ListaDocumentos> {
    const consulta = this.documentos.createQueryBuilder('documento');

    if (filtro.ordenar === 'nome') {
      consulta
        .orderBy('LOWER(documento.titulo)', 'ASC')
        .addOrderBy('documento.caminho', 'ASC');
    } else {
      consulta
        .orderBy('documento.atualizadoEm', 'DESC')
        .addOrderBy('documento.caminho', 'ASC');
    }

    if (filtro.busca) {
      consulta.andWhere(
        '(documento.titulo ILIKE :busca OR documento.caminho ILIKE :busca)',
        { busca: `%${filtro.busca}%` },
      );
    }

    if (filtro.fonte) {
      consulta.andWhere('documento.fonte = :fonte', { fonte: filtro.fonte });
    }

    if (filtro.autoridade !== undefined) {
      consulta.andWhere('documento.autoridade = :autoridade', {
        autoridade: filtro.autoridade,
      });
    }

    if (filtro.modulo === 'nenhum') {
      consulta.andWhere('documento.moduloId IS NULL');
    } else if (filtro.modulo !== undefined) {
      consulta.andWhere('documento.moduloId = :modulo', {
        modulo: filtro.modulo,
      });
    }

    const pastaReal = this.pastaParaFiltro(filtro.pasta);

    if (pastaReal) {
      const prefixo = pastaReal.replace(/[\\%_]/g, '\\$&');

      if (filtro.recursivo) {
        consulta.andWhere('documento.caminho LIKE :pasta', {
          pasta: `${prefixo}/%`,
        });
      } else {
        consulta.andWhere(
          'documento.caminho LIKE :pasta AND documento.caminho NOT LIKE :fundo',
          { pasta: `${prefixo}/%`, fundo: `${prefixo}/%/%` },
        );
      }
    }

    const [linhas, total] = await consulta
      .skip((filtro.pagina - 1) * filtro.porPagina)
      .take(filtro.porPagina)
      .getManyAndCount();

    const [trechos, tamanhos] = await Promise.all([
      this.contarTrechos(linhas.map((linha) => linha.id)),
      Promise.all(linhas.map((linha) => this.tamanhoEmDisco(linha.caminho))),
    ]);

    return {
      documentos: linhas.map((linha, indice) => ({
        ...this.resumir(linha),
        trechos: trechos.get(linha.id) ?? 0,
        bytes: tamanhos[indice] ?? 0,
      })),
      total,
      pagina: filtro.pagina,
      porPagina: filtro.porPagina,
    };
  }

  async pastas(): Promise<PastaDaBiblioteca[]> {
    const linhas = await this.documentos
      .createQueryBuilder('documento')
      .select('documento.caminho', 'caminho')
      .getRawMany<{ caminho: string }>();

    const contagem = new Map<string, number>();

    for (const linha of linhas) {
      const pasta = linha.caminho.slice(0, linha.caminho.lastIndexOf('/'));

      if (!pasta) continue;

      contagem.set(pasta, (contagem.get(pasta) ?? 0) + 1);
    }

    return [...contagem.entries()]
      .map(([caminho, documentos]) => ({
        caminho: traduzirCaminho(caminho, this.mapaExibicao),
        caminhoReal: caminho,
        documentos,
      }))
      .sort((a, b) => a.caminho.localeCompare(b.caminho));
  }

  private pastaParaFiltro(pasta?: string): string | null {
    const limpo = pasta?.trim().replace(/\/+$/, '');

    if (!limpo) return null;

    const mapa = this.mapaExibicao;

    for (const { de, para } of mapa) {
      if (limpo === para) return de;
      if (limpo.startsWith(`${para}/`))
        return `${de}${limpo.slice(para.length)}`;
    }

    return limpo;
  }

  async abrir(id: string): Promise<DocumentoAberto> {
    const documento = await this.buscar(id);
    const resumo = this.resumir(documento);
    const alvo = await resolverCaminhoNasRaizes(
      documento.caminho,
      this.raizesDeLeitura(),
    );

    const leitura = alvo.existe ? await this.lerDoDisco(alvo.real) : null;

    if (!leitura) {
      return {
        ...resumo,
        bytes: 0,
        conteudo: null,
        truncado: false,
        aviso: `"${resumo.caminho}" está indexado pelo Oráculo, mas não está legível em disco agora — o arquivo foi apagado ou trocado depois da indexação e o índice ainda não foi refeito`,
      };
    }

    return {
      ...resumo,
      bytes: leitura.bytes,
      conteudo: leitura.conteudo,
      truncado: leitura.truncado,
      aviso: leitura.truncado
        ? `documento maior que ${TETO_DE_LEITURA_BYTES} bytes — só o começo foi carregado`
        : null,
    };
  }

  private async buscar(id: string): Promise<Documento> {
    const documento = PADRAO_UUID.test(id.trim())
      ? await this.documentos.findOne({ where: { id: id.trim() } })
      : null;

    if (!documento) {
      throw new NotFoundException(`documento "${id}" não está indexado`);
    }

    return documento;
  }

  private resumir(documento: Documento): DocumentoResumido {
    return {
      id: documento.id,
      caminho: traduzirCaminho(documento.caminho, this.mapaExibicao),
      caminhoReal: documento.caminho,
      titulo: documento.titulo,
      fonte: documento.fonte,
      autoridade: documento.autoridade,
      atualizadoEm: documento.atualizadoEm,
      moduloId: documento.moduloId ?? null,
      descricao: documento.descricao ?? null,
      editavel: this.editavel(documento.caminho),
    };
  }

  private get mapaExibicao() {
    return lerMapaExibicao(this.config.corpus?.exibicao ?? []);
  }

  private diretorioDeNotas(): string | null {
    const configurado = this.config.corpus?.notas;

    return configurado ? resolve(configurado) : null;
  }

  private editavel(caminho: string): boolean {
    const notas = this.diretorioDeNotas();

    return notas !== null && caminho.startsWith(`${notas}${sep}`);
  }

  private raizesDeLeitura(): RaizResolvida[] {
    const daInstalacao = this.configuracao.raizesDeLeitura();
    const notas = this.diretorioDeNotas();

    if (!notas) {
      return daInstalacao;
    }

    const jaCoberto = daInstalacao.some(
      (raiz) => notas === raiz.real || notas.startsWith(`${raiz.real}${sep}`),
    );

    return jaCoberto
      ? daInstalacao
      : [...daInstalacao, ...resolverRaizes([notas])];
  }

  private async contarTrechos(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) {
      return new Map();
    }

    const linhas: unknown = await this.trechos.manager.query(
      `SELECT documento_id AS "documentoId", COUNT(*)::int AS total
       FROM trecho
       WHERE documento_id = ANY($1::uuid[])
       GROUP BY documento_id`,
      [ids],
    );

    const contagem = new Map<string, number>();

    if (!Array.isArray(linhas)) {
      return contagem;
    }

    for (const linha of linhas as { documentoId: string; total: number }[]) {
      contagem.set(linha.documentoId, Number(linha.total));
    }

    return contagem;
  }

  private async tamanhoEmDisco(caminho: string): Promise<number> {
    try {
      return (await stat(caminho)).size;
    } catch {
      return 0;
    }
  }

  private async lerDoDisco(
    caminhoReal: string,
  ): Promise<LeituraEmDisco | null> {
    try {
      const informacao = await stat(caminhoReal);

      if (!informacao.isFile()) {
        return null;
      }

      const handle = await open(caminhoReal, 'r');

      try {
        const limite = Math.min(informacao.size, TETO_DE_LEITURA_BYTES);
        const buffer = Buffer.alloc(limite);
        const { bytesRead } = await handle.read(buffer, 0, limite, 0);

        return {
          conteudo: buffer.subarray(0, bytesRead).toString('utf-8'),
          bytes: informacao.size,
          truncado: informacao.size > TETO_DE_LEITURA_BYTES,
        };
      } finally {
        await handle.close().catch(() => undefined);
      }
    } catch {
      return null;
    }
  }
}
