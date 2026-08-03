function padraoParaRegex(padrao: string): RegExp {
  const escapado = padrao
    .split('*')
    .map((parte) => parte.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escapado}$`, 'i');
}

export function caminhoNegado(
  caminhoRelativo: string,
  padroesNegados: readonly string[],
): boolean {
  const segmentos = caminhoRelativo.split(/[\\/]+/).filter(Boolean);
  const regexes = padroesNegados.map(padraoParaRegex);

  return segmentos.some((segmento) =>
    regexes.some((regex) => regex.test(segmento)),
  );
}
