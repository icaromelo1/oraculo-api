import type { NomeFerramenta } from '../contracts/eventos';
import type { AlcancePerfil, RetornoFerramenta } from '../security/tipos';

export interface ParametroCapacidade {
  nome: string;
  tipo: 'string' | 'numero' | 'inteiro';
  descricao: string;
  obrigatorio: boolean;
}

export interface ContextoExecucao {
  alcance: AlcancePerfil;
  usuarioId?: string | null;
}

export interface ResultadoCapacidade {
  retornos: RetornoFerramenta[];
  metrica: string;
  volume: number;
  plano?: string;
}

export interface Capacidade {
  readonly nome: NomeFerramenta;
  readonly descricao: string;
  readonly sensivel: boolean;
  readonly chaveEnv: 'conhecimento' | 'codigo' | 'estado' | 'banco';
  readonly parametros: ParametroCapacidade[];
  executar(
    argumentos: Record<string, unknown>,
    contexto: ContextoExecucao,
  ): Promise<ResultadoCapacidade>;
}

export const CAPACIDADE = Symbol('CAPACIDADE');
