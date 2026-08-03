export interface PedidoGeracao {
  sistema: string;
  mensagens: { papel: 'usuario' | 'assistente'; texto: string }[];
  maxTokens: number;
}

export type EventoProvedor =
  | { tipo: 'texto'; fragmento: string }
  | { tipo: 'raciocinio'; fragmento: string }
  | {
      tipo: 'fim';
      tokensEntrada: number;
      tokensSaida: number;
      duracaoMs: number;
      custoUsd?: number;
    }
  | { tipo: 'erro'; codigo: string; mensagem: string; retomavel: boolean };

export interface LlmProvider {
  readonly nome: string;
  gerar(pedido: PedidoGeracao): AsyncIterable<EventoProvedor>;
}

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
