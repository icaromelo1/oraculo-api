import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import {
  RaizResolvida,
  resolverRaizes,
} from '../capabilities/codigo/seguranca';
import { OraculoConfig } from './config.service';

export interface CaminhoNaRaiz {
  informado: string;
  real: string;
  raiz: RaizResolvida;
  existe: boolean;
}

export function raizesPermitidas(config: OraculoConfig): RaizResolvida[] {
  return resolverRaizes([...config.corpus.fontes, ...config.escopos.repos]);
}

async function realDoAncestral(
  caminho: string,
): Promise<{ real: string; existe: boolean }> {
  try {
    return { real: await realpath(caminho), existe: true };
  } catch {
    const pai = dirname(caminho);

    if (pai === caminho) {
      return { real: caminho, existe: false };
    }

    const doPai = await realDoAncestral(pai);

    return { real: join(doPai.real, basename(caminho)), existe: false };
  }
}

function dentroDa(raiz: RaizResolvida, caminhoReal: string): boolean {
  return (
    caminhoReal === raiz.real || caminhoReal.startsWith(`${raiz.real}${sep}`)
  );
}

export async function resolverCaminhoNasRaizes(
  caminho: string,
  raizes: readonly RaizResolvida[],
): Promise<CaminhoNaRaiz> {
  if (typeof caminho !== 'string' || caminho.trim().length === 0) {
    throw new BadRequestException(
      '"caminho" é obrigatório e precisa ser texto',
    );
  }

  const informado = caminho.trim();

  if (!isAbsolute(informado) || informado.split(/[\\/]+/).includes('..')) {
    throw new BadRequestException(
      'o caminho precisa ser absoluto e sem travessia de diretório ("..")',
    );
  }

  if (raizes.length === 0) {
    throw new ForbiddenException(
      'nenhuma raiz de leitura configurada no .env desta instalação (CORPUS_FONTES / CODIGO_REPOS)',
    );
  }

  const { real, existe } = await realDoAncestral(informado);
  const raiz = raizes.find((candidata) => dentroDa(candidata, real));

  if (!raiz) {
    throw new ForbiddenException(
      `"${informado}" está fora das raízes de leitura do .env desta instalação — o banco só recorta dentro do que o .env permite, nunca amplia`,
    );
  }

  return { informado, real, raiz, existe };
}
