export type TipoFonte = 'curado' | 'doc' | 'codigo' | 'banco' | 'inferencia';

export type NivelAutoridade = 1 | 2 | 3 | 4;

export type NomeFerramenta =
  | 'buscar_conhecimento'
  | 'buscar_codigo'
  | 'ler_arquivo'
  | 'consultar_banco'
  | 'ler_documento'
  | 'estado_servicos';

export type StatusFerramenta =
  'concluida' | 'executando' | 'na_fila' | 'bloqueada' | 'erro';

export interface LinhaTrecho {
  n: number;
  texto: string;
  destaque?: boolean;
}

export interface Fonte {
  id: string;
  tipo: TipoFonte;
  autoridade: NivelAutoridade;
  titulo: string;
  caminho: string;
  meta: string;
  porque: string;
  acao: string;
  etiqueta: string;
  detalhe: string;
  linhas: LinhaTrecho[];
}

export interface Cobertura {
  citadas: number;
  total: number;
  semFonte: number;
}

export interface Escopo {
  repositorios: string[];
  alvos: string[];
}

export interface PedidoChat {
  conversaId?: string;
  pergunta: string;
  escopo?: Escopo;
}

export interface EventoMensagemInicio {
  tipo: 'mensagem.inicio';
  id: string;
  conversaId: string;
  modelo: string;
  escopo: Escopo;
}

export interface EventoFerramentaInicio {
  tipo: 'ferramenta.inicio';
  id: string;
  nome: NomeFerramenta;
  argumento: string;
  sensivel: boolean;
}

export interface EventoFerramentaFim {
  tipo: 'ferramenta.fim';
  id: string;
  status: StatusFerramenta;
  metrica: string;
  duracaoMs: number;
  plano?: string;
  aprovadaPor?: string;
  resultado: string;
}

export interface EventoTextoDelta {
  tipo: 'texto.delta';
  fragmento: string;
}

export interface EventoCitacao {
  tipo: 'citacao';
  fonte: Fonte;
  ferramentaId: string;
}

export interface EventoAprovacaoPedido {
  tipo: 'aprovacao.pedido';
  id: string;
  comando: string;
  alvo: string;
  efeitoColateral: string;
  politica: string;
  expiraEm: string;
}

export interface EventoMensagemFim {
  tipo: 'mensagem.fim';
  cobertura: Cobertura;
  tokens: number;
  duracaoMs: number;
  /** Presente quando a resposta não teve em que se apoiar — a tela avisa e o caso vira backlog. */
  escalonamento?: Escalonamento;
}

export interface Escalonamento {
  motivo:
    'sem_fonte_recuperada' | 'resposta_sem_citacao' | 'assumido_pelo_modelo';
  explicacao: string;
}

export interface EventoErro {
  tipo: 'erro';
  codigo: string;
  mensagem: string;
  retomavel: boolean;
}

export type EventoOraculo =
  | EventoMensagemInicio
  | EventoFerramentaInicio
  | EventoFerramentaFim
  | EventoTextoDelta
  | EventoCitacao
  | EventoAprovacaoPedido
  | EventoMensagemFim
  | EventoErro;

export function serializarEvento(evento: EventoOraculo): string {
  return `event: ${evento.tipo}\ndata: ${JSON.stringify(evento)}\n\n`;
}
