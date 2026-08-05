import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  ABRIDOR_DE_SESSAO,
  abrirSessaoPostgres,
  TIMEOUT_CONEXAO_MS,
  TIMEOUT_CONSULTA_MS,
  type AbridorDeSessao,
  type RespostaConsulta,
  type SessaoBanco,
} from './conexao';
import type { ColunaDoSchema } from './apresentacao';

export const TETO_DE_COLUNAS_DO_SCHEMA = 2_000;

const TAMANHO_DO_ERRO = 300;

export interface EntradaConsulta {
  readonly url: string;
  readonly schemas: readonly string[];
  readonly sql: string;
  readonly teto: number;
}

export interface EntradaDescricao {
  readonly url: string;
  readonly schemas: readonly string[];
  readonly tabela?: string | null;
}

export type ResultadoConsulta =
  | { readonly ok: true; readonly resposta: RespostaConsulta }
  | { readonly ok: false; readonly erro: string };

export type ResultadoDescricao =
  | { readonly ok: true; readonly colunas: ColunaDoSchema[] }
  | { readonly ok: false; readonly erro: string };

const SQL_DO_SCHEMA = [
  'SELECT c.table_schema, c.table_name, c.column_name, c.data_type, c.is_nullable',
  'FROM information_schema.columns c',
  'JOIN information_schema.tables t',
  '  ON t.table_schema = c.table_schema AND t.table_name = c.table_name',
  "WHERE c.table_schema = ANY($1::text[]) AND t.table_type IN ('BASE TABLE', 'VIEW')",
  '  AND ($2::text IS NULL OR c.table_name = $2::text)',
  'ORDER BY c.table_schema, c.table_name, c.ordinal_position',
  `LIMIT ${TETO_DE_COLUNAS_DO_SCHEMA}`,
].join('\n');

function mensagemDeErro(erro: unknown): string {
  const bruto = erro instanceof Error ? erro.message : paraTexto(erro);

  return (
    bruto.replace(/\s+/g, ' ').trim().slice(0, TAMANHO_DO_ERRO) ||
    'falha desconhecida ao falar com o banco'
  );
}

function paraTexto(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

@Injectable()
export class ExecutorConsulta {
  private readonly abrir: AbridorDeSessao;

  constructor(
    @Optional()
    @Inject(ABRIDOR_DE_SESSAO)
    abridor?: AbridorDeSessao | null,
  ) {
    this.abrir = abridor ?? abrirSessaoPostgres;
  }

  async consultar(entrada: EntradaConsulta): Promise<ResultadoConsulta> {
    return this.emSessaoSomenteLeitura(
      entrada.url,
      entrada.schemas,
      async (sessao) => {
        await sessao.executar(`EXPLAIN ${entrada.sql}`);

        const resposta = await sessao.executar(entrada.sql);

        return {
          colunas: resposta.colunas,
          linhas: resposta.linhas.slice(0, entrada.teto),
        };
      },
    );
  }

  async descrever(entrada: EntradaDescricao): Promise<ResultadoDescricao> {
    const resultado = await this.emSessaoSomenteLeitura(
      entrada.url,
      entrada.schemas,
      (sessao) =>
        sessao.executar(SQL_DO_SCHEMA, [
          [...entrada.schemas],
          entrada.tabela ?? null,
        ]),
    );

    if (!resultado.ok) {
      return resultado;
    }

    return { ok: true, colunas: resultado.resposta.linhas.map(paraColuna) };
  }

  private async emSessaoSomenteLeitura(
    url: string,
    schemas: readonly string[],
    corpo: (sessao: SessaoBanco) => Promise<RespostaConsulta>,
  ): Promise<ResultadoConsulta> {
    let sessao: SessaoBanco;

    try {
      sessao = await this.abrir(url, {
        timeoutConexaoMs: TIMEOUT_CONEXAO_MS,
        timeoutConsultaMs: TIMEOUT_CONSULTA_MS,
      });
    } catch (erro) {
      return {
        ok: false,
        erro: `não foi possível conectar ao alvo: ${mensagemDeErro(erro)}`,
      };
    }

    try {
      await sessao.executar('BEGIN TRANSACTION READ ONLY');
      await sessao.executar(
        `SET LOCAL statement_timeout = ${TIMEOUT_CONSULTA_MS}`,
      );
      await sessao.executar(
        `SET LOCAL idle_in_transaction_session_timeout = ${TIMEOUT_CONSULTA_MS}`,
      );
      await sessao.executar(
        `SET LOCAL search_path = ${listaDeSchemas(schemas)}`,
      );

      return { ok: true, resposta: await corpo(sessao) };
    } catch (erro) {
      return { ok: false, erro: mensagemDeErro(erro) };
    } finally {
      await encerrar(sessao);
    }
  }
}

function listaDeSchemas(schemas: readonly string[]): string {
  return schemas.map((schema) => `"${schema}"`).join(', ');
}

async function semQuebrar(acao: () => Promise<unknown>): Promise<void> {
  try {
    await acao();
  } catch {
    return;
  }
}

async function encerrar(sessao: SessaoBanco): Promise<void> {
  await semQuebrar(() => sessao.executar('ROLLBACK'));
  await semQuebrar(() => sessao.encerrar());
}

function paraColuna(linha: unknown[]): ColunaDoSchema {
  return {
    schema: paraTexto(linha[0]),
    tabela: paraTexto(linha[1]),
    coluna: paraTexto(linha[2]),
    tipo: paraTexto(linha[3]),
    aceitaNulo: paraTexto(linha[4]).toUpperCase() === 'YES',
  };
}
