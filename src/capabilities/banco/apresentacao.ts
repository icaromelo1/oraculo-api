export const MASCARA = '[mascarado]';
export const TAMANHO_MAXIMO_VALOR = 500;
export const TAMANHO_MAXIMO_SAIDA = 60_000;

const CORTE_DO_VALOR = '…[valor cortado]';
const CORTE_DA_SAIDA = '\n[saída cortada no teto de 60 KB]';

export function indicesMascarados(
  colunas: readonly string[],
  mascaradas: readonly string[],
): number[] {
  const procuradas = new Set(
    mascaradas.map((coluna) => coluna.trim().toLowerCase()).filter(Boolean),
  );

  if (procuradas.size === 0) {
    return [];
  }

  return colunas.reduce<number[]>((indices, coluna, indice) => {
    if (procuradas.has(coluna.trim().toLowerCase())) {
      indices.push(indice);
    }

    return indices;
  }, []);
}

export function textoDoValor(valor: unknown): string {
  if (valor === null || valor === undefined) {
    return '(nulo)';
  }

  if (valor instanceof Date) {
    return valor.toISOString();
  }

  if (Buffer.isBuffer(valor)) {
    return `(binário de ${valor.length} byte(s))`;
  }

  const bruto =
    typeof valor === 'object' ? seguroComoJson(valor) : primitivo(valor);
  const achatado = bruto.replace(/[\t\r\n]+/g, ' ');

  return achatado.length > TAMANHO_MAXIMO_VALOR
    ? `${achatado.slice(0, TAMANHO_MAXIMO_VALOR)}${CORTE_DO_VALOR}`
    : achatado;
}

function primitivo(valor: unknown): string {
  if (typeof valor === 'string') {
    return valor;
  }

  if (
    typeof valor === 'number' ||
    typeof valor === 'bigint' ||
    typeof valor === 'boolean'
  ) {
    return String(valor);
  }

  return '(valor não representável)';
}

function seguroComoJson(valor: object): string {
  try {
    return JSON.stringify(valor) ?? '(nulo)';
  } catch {
    return '(valor não representável)';
  }
}

export interface TabelaFormatada {
  readonly texto: string;
  readonly truncada: boolean;
  readonly colunasMascaradas: string[];
}

export function formatarTabela(
  colunas: readonly string[],
  linhas: readonly unknown[][],
  mascaradas: readonly string[],
): TabelaFormatada {
  const indices = new Set(indicesMascarados(colunas, mascaradas));
  const cabecalho = colunas
    .map((coluna, indice) =>
      indices.has(indice) ? `${coluna} (mascarada)` : coluna,
    )
    .join(', ');

  const corpo = linhas.map((linha) =>
    colunas
      .map(
        (coluna, indice) =>
          `${coluna}=${indices.has(indice) ? MASCARA : textoDoValor(linha[indice])}`,
      )
      .join('\t'),
  );

  const montado = [
    `colunas: ${cabecalho || '(nenhuma)'}`,
    '---',
    ...(corpo.length > 0 ? corpo : ['(nenhuma linha)']),
  ].join('\n');

  const truncada = montado.length > TAMANHO_MAXIMO_SAIDA;

  return {
    texto: truncada
      ? `${montado.slice(0, TAMANHO_MAXIMO_SAIDA)}${CORTE_DA_SAIDA}`
      : montado,
    truncada,
    colunasMascaradas: [...indices].map((indice) => colunas[indice]),
  };
}

export interface ColunaDoSchema {
  readonly schema: string;
  readonly tabela: string;
  readonly coluna: string;
  readonly tipo: string;
  readonly aceitaNulo: boolean;
}

export function formatarSchema(
  colunas: readonly ColunaDoSchema[],
  mascaradas: readonly string[],
): TabelaFormatada {
  const procuradas = new Set(
    mascaradas.map((coluna) => coluna.trim().toLowerCase()).filter(Boolean),
  );
  const porTabela = new Map<string, string[]>();

  for (const coluna of colunas) {
    const chave = `${coluna.schema}.${coluna.tabela}`;
    const marca = procuradas.has(coluna.coluna.trim().toLowerCase())
      ? ' (mascarada)'
      : '';
    const nulo = coluna.aceitaNulo ? 'null' : 'not null';

    porTabela.set(chave, [
      ...(porTabela.get(chave) ?? []),
      `${coluna.coluna} ${coluna.tipo} ${nulo}${marca}`,
    ]);
  }

  const linhas = [...porTabela.entries()].map(
    ([tabela, campos]) => `${tabela}: ${campos.join(', ')}`,
  );

  const montado = [
    `tabelas: ${porTabela.size}`,
    '---',
    ...(linhas.length > 0
      ? linhas
      : ['(nenhuma tabela visível para este usuário)']),
  ].join('\n');

  const truncada = montado.length > TAMANHO_MAXIMO_SAIDA;

  return {
    texto: truncada
      ? `${montado.slice(0, TAMANHO_MAXIMO_SAIDA)}${CORTE_DA_SAIDA}`
      : montado,
    truncada,
    colunasMascaradas: [...procuradas],
  };
}
