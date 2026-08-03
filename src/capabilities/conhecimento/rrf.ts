export interface ItemFundivel {
  id: string;
  autoridade: number;
}

const CONSTANTE_RRF_PADRAO = 60;

export function fundirComRrf<T extends ItemFundivel>(
  rankings: T[][],
  constanteRrf = CONSTANTE_RRF_PADRAO,
): T[] {
  const pontuacoes = new Map<string, number>();
  const itensPorId = new Map<string, T>();

  for (const ranking of rankings) {
    ranking.forEach((item, indice) => {
      const posicao = indice + 1;
      const acumulado = pontuacoes.get(item.id) ?? 0;
      pontuacoes.set(item.id, acumulado + 1 / (constanteRrf + posicao));

      if (!itensPorId.has(item.id)) {
        itensPorId.set(item.id, item);
      }
    });
  }

  return [...itensPorId.values()].sort((a, b) => {
    const pontuacaoA = pontuacoes.get(a.id) ?? 0;
    const pontuacaoB = pontuacoes.get(b.id) ?? 0;

    if (pontuacaoA !== pontuacaoB) {
      return pontuacaoB - pontuacaoA;
    }

    return a.autoridade - b.autoridade;
  });
}
