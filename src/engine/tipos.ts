import type { Escalonamento, Escopo, Fonte } from '../contracts/eventos';
import type { BloqueioAuditado, ExecucaoAuditada } from '../security/tipos';

export interface MensagemTurno {
  papel: 'usuario' | 'assistente';
  texto: string;
}

export interface ContextoTurno {
  perfilId: string;
  conversaId?: string;
  usuarioId?: string | null;
  escopo?: Escopo;
  historico?: MensagemTurno[];
}

export interface EstadoTurno {
  fontes: Map<string, Fonte>;
  idsValidos: Set<string>;
  execucoes: ExecucaoAuditada[];
  bloqueios: BloqueioAuditado[];
  resposta: string;
  tokens: number;
  tokensSaida: number;
  iteracoes: number;
  tom: string;
  escalonamento?: Escalonamento;
}

export function novoEstado(): EstadoTurno {
  return {
    fontes: new Map(),
    idsValidos: new Set(),
    execucoes: [],
    bloqueios: [],
    resposta: '',
    tokens: 0,
    tokensSaida: 0,
    iteracoes: 0,
    tom: 'normal',
  };
}
