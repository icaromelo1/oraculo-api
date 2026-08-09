/**
 * O que o Oráculo não soube responder.
 *
 * Cada turno escalonado é uma pergunta que a base não cobre. Agrupar essas
 * perguntas é o backlog de documentação se escrevendo sozinho — em vez de alguém
 * adivinhar o que falta, o uso real diz.
 */

export const PREFIXO_ESCALONADO = 'escalonado:';

export interface Lacuna {
  motivo: string;
  perguntas: string[];
  total: number;
  ultimaEm: string;
}

export interface LinhaDeLacuna {
  tom: string;
  pergunta: string;
  criadaEm: Date;
}

const TETO_DE_EXEMPLOS = 5;

export function motivoDoTom(tom: string): string | null {
  if (!tom.startsWith(PREFIXO_ESCALONADO)) {
    return null;
  }

  const motivo = tom.slice(PREFIXO_ESCALONADO.length).trim();

  return motivo.length > 0 ? motivo : null;
}

/**
 * Agrupa por motivo, mantendo as perguntas mais recentes como amostra.
 * Pergunta repetida entra uma vez só: dez pessoas perguntando a mesma coisa é
 * um item de backlog, não dez.
 */
export function agruparLacunas(linhas: readonly LinhaDeLacuna[]): Lacuna[] {
  const porMotivo = new Map<
    string,
    { perguntas: string[]; total: number; ultimaEm: Date }
  >();
  const recentesPrimeiro = [...linhas].sort(
    (um, outro) => outro.criadaEm.getTime() - um.criadaEm.getTime(),
  );

  for (const linha of recentesPrimeiro) {
    const motivo = motivoDoTom(linha.tom);

    if (motivo === null) continue;

    const grupo = porMotivo.get(motivo) ?? {
      perguntas: [],
      total: 0,
      ultimaEm: linha.criadaEm,
    };

    grupo.total += 1;

    const pergunta = linha.pergunta.trim();
    const jaTem = grupo.perguntas.some(
      (outra) => outra.toLowerCase() === pergunta.toLowerCase(),
    );

    if (
      pergunta.length > 0 &&
      !jaTem &&
      grupo.perguntas.length < TETO_DE_EXEMPLOS
    ) {
      grupo.perguntas.push(pergunta);
    }

    porMotivo.set(motivo, grupo);
  }

  return [...porMotivo.entries()]
    .map(([motivo, grupo]) => ({
      motivo,
      perguntas: grupo.perguntas,
      total: grupo.total,
      ultimaEm: grupo.ultimaEm.toISOString(),
    }))
    .sort((um, outro) => outro.total - um.total);
}
