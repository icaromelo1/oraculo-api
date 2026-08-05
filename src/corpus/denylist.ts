function padraoParaRegex(padrao: string): RegExp {
  const escapado = padrao
    .split('*')
    .map((parte) => parte.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escapado}$`, 'i');
}

export function casaAlgumPadrao(
  segmento: string,
  padroes: readonly string[],
): boolean {
  return padroes.some((padrao) => padraoParaRegex(padrao).test(segmento));
}

export function caminhoNegado(
  caminhoRelativo: string,
  padroesNegados: readonly string[],
): boolean {
  const segmentos = caminhoRelativo.split(/[\\/]+/).filter(Boolean);

  return segmentos.some((segmento) =>
    casaAlgumPadrao(segmento, padroesNegados),
  );
}
