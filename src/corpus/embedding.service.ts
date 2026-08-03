import { Injectable } from '@nestjs/common';
import type { FeatureExtractionPipeline } from '@huggingface/transformers';
import { OraculoConfig } from '../config/config.service';

@Injectable()
export class EmbeddingService {
  private extratorPromise: Promise<FeatureExtractionPipeline> | null = null;

  constructor(private readonly config: OraculoConfig) {}

  async embutir(textos: string[], tamanhoLote = 16): Promise<number[][]> {
    if (textos.length === 0) return [];

    const extrator = await this.obterExtrator();
    const resultado: number[][] = [];

    for (let inicio = 0; inicio < textos.length; inicio += tamanhoLote) {
      const lote = textos
        .slice(inicio, inicio + tamanhoLote)
        .map((texto) => `passage: ${texto}`);

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
