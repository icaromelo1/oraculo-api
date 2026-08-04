import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { readFile } from 'node:fs/promises';
import { pareceBinario } from '../capabilities/codigo/binario';
import { Repository } from 'typeorm';
import { Documento, Trecho } from '../database/entities';
import { quebrarDocumento } from './chunking';
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
      const bruto = await readFile(arquivo.caminhoAbsoluto);

      if (pareceBinario(bruto)) {
        binariosIgnorados += 1;
        continue;
      }

      const conteudo = bruto.toString('utf-8').split(BYTE_NULO).join('');
      const procedencia = construirProcedencia(
        arquivo.caminhoAbsoluto,
        conteudo,
      );

      const existente = await this.documentos.findOne({
        where: { caminho: arquivo.caminhoAbsoluto },
      });

      if (existente && existente.hash === procedencia.hash) {
        documentosInalterados += 1;
        continue;
      }

      const documentoSalvo = await this.documentos.save({
        ...(existente ? { id: existente.id } : {}),
        caminho: arquivo.caminhoAbsoluto,
        fonte: procedencia.fonte,
        autoridade: procedencia.autoridade,
        titulo: procedencia.titulo,
        hash: procedencia.hash,
        atualizadoEm: new Date(),
        meta: existente?.meta ?? null,
      });

      if (existente) {
        await this.trechos
          .createQueryBuilder()
          .delete()
          .where('documento_id = :id', { id: documentoSalvo.id })
          .execute();
        documentosAtualizados += 1;
      } else {
        documentosNovos += 1;
      }

      const brutos = quebrarDocumento(arquivo.caminhoAbsoluto, conteudo);
      if (brutos.length === 0) continue;

      const embeddings = await this.embedding.embutir(
        brutos.map((bruto) => bruto.texto),
      );

      const entidades = brutos.map((bruto, indice) =>
        this.trechos.create({
          documento: documentoSalvo,
          ordem: bruto.ordem,
          texto: bruto.texto,
          linhaInicio: bruto.linhaInicio,
          linhaFim: bruto.linhaFim,
          embedding: embeddings[indice] ?? null,
        }),
      );

      await this.trechos.save(entidades);
      trechosGerados += entidades.length;
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
}
