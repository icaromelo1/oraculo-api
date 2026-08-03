export const CERCA_ABRE = '```oraculo-tool';
export const CERCA_FECHA = '```';

export interface PedidoModelo {
  ferramenta: string;
  argumentos: Record<string, unknown>;
}

export type LeituraBloco =
  { ok: true; pedido: PedidoModelo } | { ok: false; motivo: string };

function tentar(bruto: string): unknown {
  try {
    return JSON.parse(bruto);
  } catch {
    return undefined;
  }
}

function candidatos(bruto: string): string[] {
  const limpo = bruto
    .trim()
    .replace(/^json\s*\n/i, '')
    .trim();

  const abre = limpo.indexOf('{');
  const fecha = limpo.lastIndexOf('}');
  const recortado =
    abre >= 0 && fecha > abre ? limpo.slice(abre, fecha + 1) : limpo;

  return [
    limpo,
    recortado,
    recortado.replace(/,(\s*[}\]])/g, '$1'),
    recortado.replace(/'/g, '"'),
  ];
}

export function lerBloco(bruto: string): LeituraBloco {
  if (!bruto.trim()) {
    return { ok: false, motivo: 'o bloco chegou vazio' };
  }

  let dado: unknown;

  for (const candidato of candidatos(bruto)) {
    dado = tentar(candidato);

    if (dado !== undefined) {
      break;
    }
  }

  if (dado === undefined || dado === null || typeof dado !== 'object') {
    return {
      ok: false,
      motivo: 'o conteudo do bloco nao e um objeto JSON valido',
    };
  }

  const objeto = dado as Record<string, unknown>;
  const ferramenta = objeto.ferramenta;

  if (typeof ferramenta !== 'string' || !ferramenta.trim()) {
    return {
      ok: false,
      motivo: 'falta o campo "ferramenta" (texto) no objeto JSON',
    };
  }

  const brutosArgumentos = objeto.argumentos;

  if (
    brutosArgumentos !== undefined &&
    (typeof brutosArgumentos !== 'object' ||
      brutosArgumentos === null ||
      Array.isArray(brutosArgumentos))
  ) {
    return {
      ok: false,
      motivo: 'o campo "argumentos" precisa ser um objeto JSON',
    };
  }

  return {
    ok: true,
    pedido: {
      ferramenta: ferramenta.trim(),
      argumentos: (brutosArgumentos as Record<string, unknown>) ?? {},
    },
  };
}

export function avisoDeBlocoInvalido(motivo: string): string {
  return [
    `O pedido de ferramenta nao pode ser lido: ${motivo}.`,
    'Reenvie um unico bloco cercado ```oraculo-tool com JSON valido no formato',
    '{"ferramenta": "nome", "argumentos": {"parametro": "valor"}} — sem comentario,',
    'sem texto extra dentro do bloco e sem virgula sobrando.',
  ].join(' ');
}

export function avisoDeBloqueio(ferramenta: string, motivo: string): string {
  return [
    `A ferramenta "${ferramenta}" NAO foi executada. Motivo: ${motivo}.`,
    'Esta decisao e da politica de seguranca e nao pode ser contornada:',
    'nao reenvie o mesmo pedido, nao tente outra ferramenta para o mesmo alvo',
    'e nao invente o conteudo que ela traria. Siga com o que ja tem ou diga ao',
    'usuario que isso esta fora do alcance desta sessao.',
  ].join(' ');
}

export function avisoDeFalha(ferramenta: string, motivo: string): string {
  return [
    `A ferramenta "${ferramenta}" falhou ao executar: ${motivo}.`,
    'Nao invente o resultado. Tente outro caminho ou responda com o que ja tem.',
  ].join(' ');
}

export function avisoSemResultado(ferramenta: string): string {
  return `A ferramenta "${ferramenta}" executou e nao devolveu nenhum trecho. Nao ha fonte para citar sobre esse ponto.`;
}
