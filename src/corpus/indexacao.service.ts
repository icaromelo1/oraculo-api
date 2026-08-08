import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { readFile } from 'node:fs/promises';
import { pareceBinario } from '../capabilities/codigo/binario';
import { extrairTextoDePdf, pareceDocumentoPdf } from '../conhecimento/pdf';
import { Repository } from 'typeorm';
import { Documento, Trecho } from '../database/entities';
import { quebrarDocumento } from './chunking';
import { OraculoConfig } from '../config/config.service';
import { construirProcedencia } from './procedencia';
import { VarreduraService } from './varredura.service';
import { EmbeddingService } from './embedding.service';

const BYTE_NULO = String.fromCharCode(0);

export interface ResumoIndexacao {
  documentosNovos: number;
  documentosAtualizados: number;
  documentosInalterados: number;
  trechosGerados: number;
  recusadosPelaDenylist: number;
  binariosIgnorados: number;
  duracaoMs: number;
}

export type StatusArquivo =
  'novo' | 'atualizado' | 'inalterado' | 'binario_ignorado';

export interface ResultadoArquivo {
  documentoId: string | null;
  status: StatusArquivo;
  trechos: number;
}

@Injectable()
export class IndexacaoService {
  private readonly logger = new Logger(IndexacaoService.name);

  constructor(
    private readonly varredura: VarreduraService,
    private readonly embedding: EmbeddingService,
    @InjectRepository(Documento)
    private readonly documentos: Repository<Documento>,
    @InjectRepository(Trecho)
    private readonly trechos: Repository<Trecho>,
    private readonly config: OraculoConfig,
  ) {}

  async executar(): Promise<ResumoIndexacao> {
    const inicio = Date.now();
    const { arquivos, recusadosPelaDenylist } = await this.varredura.varrer();

    let documentosNovos = 0;
    let documentosAtualizados = 0;
    let documentosInalterados = 0;
    let trechosGerados = 0;
    let binariosIgnorados = 0;

    for (const arquivo of arquivos) {
      const resultado = await this.indexarArquivo(arquivo.caminhoAbsoluto);

      if (resultado.status === 'binario_ignorado') binariosIgnorados += 1;
      if (resultado.status === 'inalterado') documentosInalterados += 1;
      if (resultado.status === 'atualizado') documentosAtualizados += 1;
      if (resultado.status === 'novo') documentosNovos += 1;

      trechosGerados += resultado.trechos;
    }

    const duracaoMs = Date.now() - inicio;

    this.logger.log(
      `indexação concluída — ${documentosNovos} novos, ${documentosAtualizados} atualizados, ` +
        `${documentosInalterados} inalterados, ${trechosGerados} trechos, ` +
        `${recusadosPelaDenylist} recusados pela denylist, ` +
        `${binariosIgnorados} binários ignorados, ${duracaoMs}ms`,
    );

    return {
      documentosNovos,
      documentosAtualizados,
      documentosInalterados,
      trechosGerados,
      recusadosPelaDenylist,
      binariosIgnorados,
      duracaoMs,
    };
  }

  async indexarArquivo(caminhoAbsoluto: string): Promise<ResultadoArquivo> {
    const bruto = await readFile(caminhoAbsoluto);

    if (pareceDocumentoPdf(caminhoAbsoluto, undefined, bruto)) {
      return this.indexarPdf(caminhoAbsoluto, bruto);
    }

    if (pareceBinario(bruto)) {
      return { documentoId: null, status: 'binario_ignorado', trechos: 0 };
    }

    return this.indexarConteudo(
      caminhoAbsoluto,
      bruto.toString('utf-8').split(BYTE_NULO).join(''),
    );
  }

  private async indexarPdf(
    caminhoAbsoluto: string,
    bruto: Buffer,
  ): Promise<ResultadoArquivo> {
    const extraido = await extrairTextoDePdf(caminhoAbsoluto, bruto);

    if (!extraido.aceito) {
      this.logger.warn(
        `pdf sem texto extraível ignorado: ${caminhoAbsoluto} — ${extraido.motivo}`,
      );

      return { documentoId: null, status: 'binario_ignorado', trechos: 0 };
    }

    return this.indexarConteudo(caminhoAbsoluto, extraido.texto);
  }

  private async indexarConteudo(
    caminhoAbsoluto: string,
    conteudo: string,
  ): Promise<ResultadoArquivo> {
    const procedencia = construirProcedencia(
      caminhoAbsoluto,
      conteudo,
      this.config.corpus.notas,
    );

    const existente = await this.documentos.findOne({
      where: { caminho: caminhoAbsoluto },
    });

    if (existente && existente.hash === procedencia.hash) {
      return {
        documentoId: existente.id,
        status: 'inalterado',
        trechos: 0,
      };
    }

    const documentoSalvo = await this.documentos.save({
      ...(existente ? { id: existente.id } : {}),
      caminho: caminhoAbsoluto,
      fonte: procedencia.fonte,
      autoridade: procedencia.autoridade,
      titulo: procedencia.titulo,
      hash: procedencia.hash,
      atualizadoEm: new Date(),
      meta: existente?.meta ?? null,
      moduloId: existente?.moduloId ?? null,
      descricao: existente?.descricao ?? null,
    });

    const status: StatusArquivo = existente ? 'atualizado' : 'novo';

    if (existente) {
      await this.apagarTrechos(documentoSalvo.id);
    }

    const brutos = quebrarDocumento(caminhoAbsoluto, conteudo);

    if (brutos.length === 0) {
      return { documentoId: documentoSalvo.id, status, trechos: 0 };
    }

    const embeddings = await this.embedding.embutir(
      brutos.map((pedaco) => pedaco.texto),
    );

    const entidades = brutos.map((pedaco, indice) =>
      this.trechos.create({
        documento: documentoSalvo,
        ordem: pedaco.ordem,
        texto: pedaco.texto,
        linhaInicio: pedaco.linhaInicio,
        linhaFim: pedaco.linhaFim,
        embedding: embeddings[indice] ?? null,
      }),
    );

    await this.trechos.save(entidades);

    return {
      documentoId: documentoSalvo.id,
      status,
      trechos: entidades.length,
    };
  }

  async removerArquivo(caminhoAbsoluto: string): Promise<boolean> {
    const existente = await this.documentos.findOne({
      where: { caminho: caminhoAbsoluto },
    });

    if (!existente) {
      return false;
    }

    await this.apagarTrechos(existente.id);
    await this.documentos.delete({ id: existente.id });

    return true;
  }

  private async apagarTrechos(documentoId: string): Promise<void> {
    await this.trechos
      .createQueryBuilder()
      .delete()
      .where('documento_id = :id', { id: documentoId })
      .execute();
  }
}
