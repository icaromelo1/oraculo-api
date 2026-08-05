const PADROES_DO_PROPRIO_ORACULO: readonly string[] = [
  'oraculo-api',
  'oraculo-ui',
  'oraculo',
  'project_oraculo_*',
];

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
  const padroes = [...PADROES_DO_PROPRIO_ORACULO, ...padroesNegados];

  return segmentos.some((segmento) => casaAlgumPadrao(segmento, padroes));
}

export function ehDoProprioOraculo(caminho: string): boolean {
  return caminho
    .split(/[\\/]+/)
    .filter(Boolean)
    .some((segmento) => casaAlgumPadrao(segmento, PADROES_DO_PROPRIO_ORACULO));
}
