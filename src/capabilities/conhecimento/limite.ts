export const LIMITE_PADRAO = 6;
export const LIMITE_TETO = 12;

export function normalizarLimite(valor: unknown): number {
  let numero: number;

  if (typeof valor === 'number') {
    numero = valor;
  } else if (typeof valor === 'string' && valor.trim() !== '') {
    numero = Number(valor);
  } else {
    return LIMITE_PADRAO;
  }

  if (!Number.isFinite(numero)) {
    return LIMITE_PADRAO;
  }

  return Math.min(LIMITE_TETO, Math.max(1, Math.trunc(numero)));
}
