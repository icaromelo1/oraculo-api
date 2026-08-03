import { readFileSync } from 'node:fs';
import { Injectable } from '@nestjs/common';
import { OraculoConfig } from '../../config/config.service';
import { caminhoNegado } from '../../corpus/denylist';
import type {
  Capacidade,
  ParametroCapacidade,
  ResultadoCapacidade,
} from '../capacidade';
import { pareceBinario } from './binario';
import {
  arquivoRegular,
  resolverRaizes,
  tamanhoDoArquivo,
  validarCaminhoDentroDasRaizes,
} from './seguranca';

const TAMANHO_MAXIMO_ARQUIVO = 2_000_000;
const LIMITE_LINHAS = 500;

@Injectable()
export class LerArquivoCapacidade implements Capacidade {
  readonly nome = 'ler_arquivo' as const;
  readonly descricao =
    'le uma faixa de linhas de um arquivo dentro dos repositorios liberados';
  readonly sensivel = false;
  readonly chaveEnv = 'codigo' as const;
  readonly parametros: ParametroCapacidade[] = [
    {
      nome: 'caminho',
      tipo: 'string',
      descricao: 'caminho absoluto do arquivo',
      obrigatorio: true,
    },
    {
      nome: 'inicio',
      tipo: 'inteiro',
      descricao: 'primeira linha a devolver (1-based)',
      obrigatorio: false,
    },
    {
      nome: 'fim',
      tipo: 'inteiro',
      descricao: 'ultima linha a devolver (1-based)',
      obrigatorio: false,
    },
  ];

  constructor(private readonly config: OraculoConfig) {}

  async executar(
    argumentos: Record<string, unknown>,
  ): Promise<ResultadoCapacidade> {
    await Promise.resolve();

    const caminho =
      typeof argumentos.caminho === 'string' ? argumentos.caminho.trim() : '';

    if (!caminho) {
      return {
        retornos: [],
        metrica: 'bloqueado: caminho ausente',
        volume: 0,
      };
    }

    const raizes = resolverRaizes(this.config.escopos.repos);
    const validado = validarCaminhoDentroDasRaizes(caminho, raizes);

    if (!validado) {
      return {
        retornos: [],
        metrica: 'bloqueado: caminho fora das raizes permitidas',
        volume: 0,
      };
    }

    if (caminhoNegado(validado.relativo, this.config.corpus.negados)) {
      return {
        retornos: [],
        metrica: 'bloqueado: caminho negado pelo corpus',
        volume: 0,
      };
    }

    if (!arquivoRegular(validado.caminhoReal)) {
      return {
        retornos: [],
        metrica: 'bloqueado: nao e um arquivo regular',
        volume: 0,
      };
    }

    const tamanho = tamanhoDoArquivo(validado.caminhoReal);

    if (tamanho === null) {
      return {
        retornos: [],
        metrica: 'bloqueado: arquivo inacessivel',
        volume: 0,
      };
    }

    if (tamanho > TAMANHO_MAXIMO_ARQUIVO) {
      return {
        retornos: [],
        metrica: 'bloqueado: arquivo maior que o teto permitido',
        volume: 0,
      };
    }

    let buffer: Buffer;

    try {
      buffer = readFileSync(validado.caminhoReal);
    } catch {
      return {
        retornos: [],
        metrica: 'bloqueado: falha ao ler o arquivo',
        volume: 0,
      };
    }

    if (pareceBinario(buffer)) {
      return {
        retornos: [],
        metrica: 'bloqueado: arquivo binario',
        volume: 0,
      };
    }

    const texto = buffer.toString('utf8');
    const linhas = texto.split('\n');

    if (texto.endsWith('\n') && linhas.length > 0) {
      linhas.pop();
    }

    const inicio = this.normalizarLinha(argumentos.inicio, 1);
    const fimSolicitado = Math.min(
      this.normalizarLinha(argumentos.fim, linhas.length),
      linhas.length,
    );
    const fim = Math.min(fimSolicitado, inicio + LIMITE_LINHAS - 1);

    if (inicio > linhas.length || inicio > fim) {
      return { retornos: [], metrica: '0 linhas', volume: 0 };
    }

    const recorte = linhas.slice(inicio - 1, fim);
    const conteudo = recorte
      .map((texto, indice) => `${inicio + indice}: ${texto}`)
      .join('\n');

    return {
      retornos: [
        {
          origem: {
            ferramenta: 'ler_arquivo',
            tipo: 'codigo',
            caminho: validado.relativo,
            meta: `linhas ${inicio}-${fim}`,
          },
          conteudo,
          truncado: fim < fimSolicitado,
        },
      ],
      metrica: `${fim - inicio + 1} linhas`,
      volume: fim - inicio + 1,
    };
  }

  private normalizarLinha(valor: unknown, padrao: number): number {
    const numero = typeof valor === 'number' ? valor : Number(valor);

    if (!Number.isFinite(numero) || !Number.isInteger(numero) || numero < 1) {
      return padrao;
    }

    return numero;
  }
}
