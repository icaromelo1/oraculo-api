import type { TipoFonte } from '../contracts/eventos';

export type TipoFerramentaAuditoria = TipoFonte | 'shell';

export interface FerramentaAuditoria {
  sigla: string;
  tipo: TipoFerramentaAuditoria;
  bloqueada: boolean;
}

export type TomResultado = 'ok' | 'aviso' | 'erro' | 'neutro';

export type CategoriaResultado =
  'ok' | 'bloqueado' | 'aprovado' | 'sem_resultado' | 'erro';

export const CATEGORIAS_RESULTADO: readonly CategoriaResultado[] = [
  'ok',
  'bloqueado',
  'aprovado',
  'sem_resultado',
  'erro',
];

export interface RegistroAuditoria {
  id: string;
  hora: string;
  usuario: string;
  perfil: string;
  pergunta: string;
  ferramentas: FerramentaAuditoria[];
  fontes: number;
  resultado: string;
  tomResultado: TomResultado;
  duracao: string;
  modelo: string;
  trilha?: string[];
  sqlExecutado?: string;
  notaSql?: string;
}

export interface ListaAuditoria {
  registros: RegistroAuditoria[];
  total: number;
  pagina: number;
  porPagina: number;
}

export interface CartaoResumo {
  rotulo: string;
  valor: string;
  tom: TomResultado;
}
