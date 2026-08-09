import type { Cobertura, Escalonamento } from '../contracts/eventos';

export const FRASE_DE_ESCALONAMENTO =
  'Não tenho conhecimento suficiente sobre isso — leve para a equipe de desenvolvimento.';

export type MotivoDeEscalonamento = Escalonamento['motivo'];

const EXPLICACAO: Record<MotivoDeEscalonamento, string> = {
  sem_fonte_recuperada:
    'nenhuma busca desta conversa devolveu trecho: não há material indexado sobre o assunto',
  resposta_sem_citacao:
    'a resposta afirmou coisas sem citar nenhuma fonte válida',
  assumido_pelo_modelo:
    'o próprio modelo declarou não ter conhecimento suficiente',
};

// A frase pode chegar com acento ou sem, com reticências, dentro de um parágrafo maior.
const PADRAO_DA_FRASE =
  /n[aã]o\s+tenho\s+conhecimento\s+suficiente|leve\s+para\s+a\s+equipe\s+de\s+desenvolvimento/i;

export interface EntradaDeEscalonamento {
  cobertura: Cobertura;
  fontesRecuperadas: number;
  texto: string;
}

/**
 * Decide se o turno deve ser marcado como escalonamento.
 *
 * Não é sobre a resposta estar errada — é sobre ela não ter em que se apoiar.
 * Turno sem resposta nenhuma (erro de provedor) não escala: aquilo é falha, não lacuna.
 */
export function decidirEscalonamento(
  entrada: EntradaDeEscalonamento,
): Escalonamento | null {
  const texto = entrada.texto.trim();

  if (texto.length === 0) {
    return null;
  }

  if (PADRAO_DA_FRASE.test(texto)) {
    return escalonar('assumido_pelo_modelo');
  }

  if (entrada.fontesRecuperadas === 0) {
    return escalonar('sem_fonte_recuperada');
  }

  if (entrada.cobertura.total > 0 && entrada.cobertura.citadas === 0) {
    return escalonar('resposta_sem_citacao');
  }

  return null;
}

function escalonar(motivo: MotivoDeEscalonamento): Escalonamento {
  return { motivo, explicacao: EXPLICACAO[motivo] };
}
