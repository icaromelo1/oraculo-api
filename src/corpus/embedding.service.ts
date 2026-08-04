import { Injectable } from '@nestjs/common';
import type { FeatureExtractionPipeline } from '@huggingface/transformers';
import { OraculoConfig } from '../config/config.service';

export type PrefixoEmbedding = 'passage' | 'query';

export interface OpcoesEmbutir {
  tamanhoLote?: number;
  prefixo?: PrefixoEmbedding;
}

const TETO_CARACTERES = 2000;

export function prepararLote(
  textos: string[],
  prefixo: PrefixoEmbedding,
): string[] {
  return textos.map(
    (texto) => `${prefixo}: ${texto.slice(0, TETO_CARACTERES)}`,
  );
}

@Injectable()
export class EmbeddingService {
  private extratorPromise: Promise<FeatureExtractionPipeline> | null = null;

  constructor(private readonly config: OraculoConfig) {}

  async embutir(
    textos: string[],
    opcoes: OpcoesEmbutir = {},
  ): Promise<number[][]> {
    if (textos.length === 0) return [];

    const { tamanhoLote = 16, prefixo = 'passage' } = opcoes;
    const extrator = await this.obterExtrator();
    const resultado: number[][] = [];

    for (let inicio = 0; inicio < textos.length; inicio += tamanhoLote) {
      const lote = prepararLote(
        textos.slice(inicio, inicio + tamanhoLote),
        prefixo,
      );

      const saida = await extrator(lote, { pooling: 'mean', normalize: true });
      resultado.push(...(saida.tolist() as number[][]));
    }

    return resultado;
  }

  private async obterExtrator(): Promise<FeatureExtractionPipeline> {
    if (!this.extratorPromise) {
      this.extratorPromise = this.carregarExtrator();
    }

    return this.extratorPromise;
  }

  private async carregarExtrator(): Promise<FeatureExtractionPipeline> {
    const { pipeline } = await import('@huggingface/transformers');

    return pipeline(
      'feature-extraction',
      this.config.recuperacao.modeloEmbedding,
      {
        device: 'cpu',
      },
    );
  }
}
