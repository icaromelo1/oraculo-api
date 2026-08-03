export function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null;
}

export function lerString(valor: unknown): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

export function lerNumero(valor: unknown): number | undefined {
  return typeof valor === 'number' ? valor : undefined;
}

export function analisarJsonSeguro(texto: string): unknown {
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    return undefined;
  }
}
