import { compileFunction, constants } from 'node:vm';

type ModuloUnpdf = typeof import('unpdf');

const importarPeloCarregadorPrincipal = compileFunction(
  'return import(especificador)',
  ['especificador'],
  {
    filename: __filename,
    importModuleDynamically:
      constants.USE_MAIN_CONTEXT_DEFAULT_LOADER as unknown as undefined,
  },
) as (especificador: string) => Promise<ModuloUnpdf>;

let carregado: Promise<ModuloUnpdf> | null = null;

export function unpdfDeVerdade(): Promise<ModuloUnpdf> {
  carregado ??= importarPeloCarregadorPrincipal('unpdf');

  return carregado;
}

export function delegarParaUnpdfReal(): Record<string, unknown> {
  return {
    getDocumentProxy: (...argumentos: unknown[]) =>
      chamar('getDocumentProxy', argumentos),
    extractText: (...argumentos: unknown[]) =>
      chamar('extractText', argumentos),
  };
}

async function chamar(nome: string, argumentos: unknown[]): Promise<unknown> {
  const modulo = (await unpdfDeVerdade()) as unknown as Record<
    string,
    (...argumentos: unknown[]) => Promise<unknown>
  >;

  return modulo[nome](...argumentos);
}
