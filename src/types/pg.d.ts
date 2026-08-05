declare module 'pg' {
  export interface CampoResultado {
    name: string;
  }

  export interface ResultadoConsulta {
    fields: CampoResultado[];
    rows: unknown[][];
  }

  export interface ConfiguracaoCliente {
    connectionString?: string;
    application_name?: string;
    connectionTimeoutMillis?: number;
    query_timeout?: number;
    statement_timeout?: number;
    idle_in_transaction_session_timeout?: number;
  }

  export interface PedidoConsulta {
    text: string;
    values?: unknown[];
    rowMode?: 'array';
  }

  export class Client {
    constructor(configuracao: ConfiguracaoCliente);
    connect(): Promise<void>;
    query(pedido: PedidoConsulta): Promise<ResultadoConsulta>;
    end(): Promise<void>;
  }
}
