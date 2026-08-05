import { readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export interface RaizResolvida {
  original: string;
  real: string;
}

export interface CaminhoValidado {
  raiz: RaizResolvida;
  caminhoReal: string;
  relativo: string;
}

export function resolverRaizes(raizes: readonly string[]): RaizResolvida[] {
  const resolvidas: RaizResolvida[] = [];

  for (const raiz of raizes) {
    try {
      resolvidas.push({ original: raiz, real: realpathSync(resolve(raiz)) });
    } catch {
      continue;
    }
  }

  return resolvidas;
}

export function raizesComConteudo(raizes: readonly string[]): RaizResolvida[] {
  return resolverRaizes(raizes).filter((raiz) => {
    try {
      return readdirSync(raiz.real).length > 0;
    } catch {
      return false;
    }
  });
}

export function validarCaminhoDentroDasRaizes(
  caminho: string,
  raizes: readonly RaizResolvida[],
): CaminhoValidado | null {
  if (!isAbsolute(caminho) || caminho.includes('..')) {
    return null;
  }

  let caminhoReal: string;

  try {
    caminhoReal = realpathSync(caminho);
  } catch {
    return null;
  }

  for (const raiz of raizes) {
    if (
      caminhoReal === raiz.real ||
      caminhoReal.startsWith(`${raiz.real}${sep}`)
    ) {
      return { raiz, caminhoReal, relativo: relative(raiz.real, caminhoReal) };
    }
  }

  return null;
}

export function arquivoRegular(caminhoReal: string): boolean {
  try {
    return statSync(caminhoReal).isFile();
  } catch {
    return false;
  }
}

export function tamanhoDoArquivo(caminhoReal: string): number | null {
  try {
    return statSync(caminhoReal).size;
  } catch {
    return null;
  }
}
