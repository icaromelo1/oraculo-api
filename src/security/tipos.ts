import type { StatusPerfilCapacidade } from '../database/entities';

export type TipoSegredo =
  | 'cpf'
  | 'cnpj'
  | 'email'
  | 'telefone'
  | 'cartao'
  | 'chave_privada'
  | 'token'
  | 'senha'
  | 'ip'
  | 'host';

export interface OcorrenciaRedacao {
  tipo: TipoSegredo;
  quantidade: number;
}

export interface ResultadoRedacao {
  texto: string;
  total: number;
  ocorrencias: OcorrenciaRedacao[];
}

export interface OrigemConteudo {
  ferramenta: string;
  tipo: string;
  caminho: string;
  titulo?: string;
  meta?: string;
}

export interface EntradaEnvelope {
  origem: OrigemConteudo;
  conteudo: string;
  truncado?: boolean;
}

export interface RetornoFerramenta {
  origem: OrigemConteudo;
  conteudo: string;
  truncado?: boolean;
}

export interface RetornoProtegido {
  texto: string;
  redacao: ResultadoRedacao;
}

export type Decisao = 'permitir' | 'exigir_aprovacao' | 'bloquear';

export type Politica =
  | 'capacidade_desconhecida'
  | 'capacidade_desligada'
  | 'sem_permissao_explicita'
  | 'negada_no_perfil'
  | 'argumento_invalido'
  | 'fora_de_escopo'
  | 'caminho_negado'
  | 'escrita_no_banco'
  | 'comando_fora_da_allowlist'
  | 'aprovacao_exigida_no_perfil'
  | 'capacidade_sensivel'
  | 'permitida';

export interface CapacidadeDoPerfil {
  capacidade: string;
  status: StatusPerfilCapacidade;
  escopo: Record<string, unknown> | null;
}

export interface AlcancePerfil {
  perfilId: string;
  perfil: string;
  capacidades: CapacidadeDoPerfil[];
}

export interface PedidoFerramenta {
  capacidade: string;
  argumentos: Record<string, unknown>;
  alcance: AlcancePerfil;
  usuarioId?: string | null;
  pergunta?: string;
  modelo?: string;
}

export interface Veredito {
  capacidade: string;
  decisao: Decisao;
  politica: Politica;
  motivo: string;
}

export interface ExecucaoAuditada {
  nome: string;
  argumento?: Record<string, unknown>;
  status: string;
  duracaoMs?: number;
  aprovadaPor?: string | null;
  redacoes?: OcorrenciaRedacao[];
}

export interface BloqueioAuditado {
  capacidade: string;
  decisao: Decisao;
  politica: Politica;
  motivo: string;
  argumento?: Record<string, unknown>;
}

export interface RegistroTurno {
  usuarioId?: string | null;
  pergunta: string;
  ferramentas?: ExecucaoAuditada[];
  bloqueios?: BloqueioAuditado[];
  fontes?: number;
  resultado: string;
  tom?: string;
  duracaoMs: number;
  modelo: string;
}

export interface RegistroBloqueio {
  usuarioId?: string | null;
  pergunta?: string;
  modelo?: string;
  bloqueio: BloqueioAuditado;
}
