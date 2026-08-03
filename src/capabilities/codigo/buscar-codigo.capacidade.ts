import { basename, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { OraculoConfig } from '../../config/config.service';
import { caminhoNegado } from '../../corpus/denylist';
import type { RetornoFerramenta } from '../../security/tipos';
import type {
  Capacidade,
  ParametroCapacidade,
  ResultadoCapacidade,
} from '../capacidade';
import { analisarSaidaDoGrep, executarGitGrep } from './git-grep';
import {
  arquivoRegular,
  resolverRaizes,
  validarCaminhoDentroDasRaizes,
  type RaizResolvida,
} from './seguranca';

const LIMITE_PADRAO = 8;
const LIMITE_MAXIMO = 20;
const LIMITE_LINHAS_POR_ARQUIVO = 30;

@Injectable()
export class BuscarCodigoCapacidade implements Capacidade {
  readonly nome = 'buscar_codigo' as const;
  readonly descricao =
    'busca um padrao de texto no codigo-fonte dos repositorios liberados, via git grep';
  readonly sensivel = false;
  readonly chaveEnv = 'codigo' as const;
  readonly parametros: ParametroCapacidade[] = [
    {
      nome: 'padrao',
      tipo: 'string',
      descricao: 'texto a buscar nos arquivos',
      obrigatorio: true,
    },
    {
      nome: 'repo',
      tipo: 'string',
      descricao: 'restringe a busca a um dos repositorios de CODIGO_REPOS',
      obrigatorio: false,
    },
    {
      nome: 'limite',
      tipo: 'inteiro',
      descricao: 'numero maximo de arquivos no retorno (padrao 8, teto 20)',
      obrigatorio: false,
    },
  ];

  constructor(private readonly config: OraculoConfig) {}

  async executar(
    argumentos: Record<string, unknown>,
  ): Promise<ResultadoCapacidade> {
    const padrao =
      typeof argumentos.padrao === 'string' ? argumentos.padrao.trim() : '';

    if (!padrao) {
      return { retornos: [], metrica: 'bloqueado: padrao ausente', volume: 0 };
    }

    const limite = this.normalizarLimite(argumentos.limite);
    const repos = this.repositoriosAlvo(argumentos.repo);
    const negados = this.config.corpus.negados;
    const retornos: RetornoFerramenta[] = [];

    for (const raiz of repos) {
      if (retornos.length >= limite) {
        break;
      }

      const encontrados = await this.buscarNoRepo(raiz, padrao, negados);

      for (const [caminhoRelativo, linhas] of encontrados) {
        if (retornos.length >= limite) {
          break;
        }

        const recorte = linhas.slice(0, LIMITE_LINHAS_POR_ARQUIVO);
        const conteudo = recorte
          .map((linha) => `${linha.numero}: ${linha.texto}`)
          .join('\n');
        const numeros = recorte.map((linha) => linha.numero).join(', ');

        retornos.push({
          origem: {
            ferramenta: 'buscar_codigo',
            tipo: 'codigo',
            caminho: caminhoRelativo,
            meta: `linhas ${numeros}`,
          },
          conteudo,
          truncado: linhas.length > recorte.length,
        });
      }
    }

    return {
      retornos,
      metrica: `${retornos.length} arquivo${retornos.length === 1 ? '' : 's'}`,
      volume: retornos.length,
    };
  }

  private async buscarNoRepo(
    raiz: RaizResolvida,
    padrao: string,
    negados: readonly string[],
  ): Promise<Array<[string, { numero: number; texto: string }[]]>> {
    const saida = await executarGitGrep(raiz.real, padrao);
    const porArquivo = analisarSaidaDoGrep(saida);
    const validos: Array<[string, { numero: number; texto: string }[]]> = [];

    for (const [caminhoRelativoGit, linhas] of porArquivo) {
      const caminhoAbsoluto = resolve(raiz.real, caminhoRelativoGit);
      const validado = validarCaminhoDentroDasRaizes(caminhoAbsoluto, [raiz]);

      if (!validado) {
        continue;
      }

      if (caminhoNegado(validado.relativo, negados)) {
        continue;
      }

      if (!arquivoRegular(validado.caminhoReal)) {
        continue;
      }

      validos.push([validado.relativo, linhas]);
    }

    return validos;
  }

  private repositoriosAlvo(repoArgumento: unknown): RaizResolvida[] {
    const raizes = resolverRaizes(this.config.escopos.repos);

    if (typeof repoArgumento !== 'string' || !repoArgumento.trim()) {
      return raizes;
    }

    const alvo = repoArgumento.trim();

    return raizes.filter(
      (raiz) => raiz.original === alvo || basename(raiz.original) === alvo,
    );
  }

  private normalizarLimite(valor: unknown): number {
    const numero = typeof valor === 'number' ? valor : Number(valor);

    if (!Number.isFinite(numero) || !Number.isInteger(numero) || numero < 1) {
      return LIMITE_PADRAO;
    }

    return Math.min(numero, LIMITE_MAXIMO);
  }
}
