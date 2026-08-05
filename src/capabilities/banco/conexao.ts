import { Client } from 'pg';

export const ABRIDOR_DE_SESSAO = Symbol('ABRIDOR_DE_SESSAO');

export const TIMEOUT_CONEXAO_MS = 5_000;
export const TIMEOUT_CONSULTA_MS = 8_000;

export interface RespostaConsulta {
  readonly colunas: string[];
  readonly linhas: unknown[][];
}

export interface SessaoBanco {
  executar(sql: string, parametros?: unknown[]): Promise<RespostaConsulta>;
  encerrar(): Promise<void>;
}

export interface OpcoesSessao {
  readonly timeoutConexaoMs: number;
  readonly timeoutConsultaMs: number;
}

export type AbridorDeSessao = (
  url: string,
  opcoes: OpcoesSessao,
) => Promise<SessaoBanco>;

export const abrirSessaoPostgres: AbridorDeSessao = async (url, opcoes) => {
  const cliente = new Client({
    connectionString: url,
    application_name: 'oraculo',
    connectionTimeoutMillis: opcoes.timeoutConexaoMs,
    query_timeout: opcoes.timeoutConsultaMs,
    statement_timeout: opcoes.timeoutConsultaMs,
    idle_in_transaction_session_timeout: opcoes.timeoutConsultaMs,
  });

  await cliente.connect();

  return {
    async executar(sql, parametros) {
      const resultado = await cliente.query({
        text: sql,
        values: parametros ?? [],
        rowMode: 'array',
      });

      return {
        colunas: (resultado.fields ?? []).map((campo) => campo.name),
        linhas: resultado.rows ?? [],
      };
    },
    async encerrar() {
      await cliente.end();
    },
  };
};
