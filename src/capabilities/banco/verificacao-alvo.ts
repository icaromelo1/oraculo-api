import { AbridorDeSessao, SessaoBanco, TIMEOUT_CONEXAO_MS } from './conexao';

const SQL_PODERES = `
  SELECT
    (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superusuario,
    (
      SELECT count(*)
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p')
        AND n.nspname = ANY($1::text[])
        AND (
          has_table_privilege(c.oid, 'INSERT')
          OR has_table_privilege(c.oid, 'UPDATE')
          OR has_table_privilege(c.oid, 'DELETE')
          OR has_table_privilege(c.oid, 'TRUNCATE')
        )
    ) AS tabelas_graváveis
`;

export interface VeredictoDoAlvo {
  somenteLeitura: boolean;
  motivo?: string;
}

export async function verificarSomenteLeitura(
  url: string,
  schemas: readonly string[],
  abrir: AbridorDeSessao,
): Promise<VeredictoDoAlvo> {
  const alvos = schemas.length > 0 ? [...schemas] : ['public'];

  let sessao: SessaoBanco;

  try {
    sessao = await abrir(url, {
      timeoutConexaoMs: TIMEOUT_CONEXAO_MS,
      timeoutConsultaMs: TIMEOUT_CONEXAO_MS,
    });
  } catch (erro) {
    return {
      somenteLeitura: false,
      motivo: `não consegui conectar no alvo para conferir os privilégios: ${
        erro instanceof Error ? erro.message : String(erro)
      }`,
    };
  }

  try {
    const resposta = await sessao.executar(SQL_PODERES, [alvos]);
    const linha = resposta.linhas[0] ?? [];
    const superusuario = linha[0] === true;
    const graváveis = Number(linha[1] ?? 0);

    if (superusuario) {
      return {
        somenteLeitura: false,
        motivo:
          'esse usuário é superusuário do Postgres — cadastre um usuário criado só com GRANT SELECT, senão a defesa principal do alvo não existe',
      };
    }

    if (graváveis > 0) {
      return {
        somenteLeitura: false,
        motivo: `esse usuário pode escrever em ${graváveis} tabela(s) do(s) schema(s) ${alvos.join(', ')} — cadastre um usuário criado só com GRANT SELECT`,
      };
    }

    return { somenteLeitura: true };
  } catch (erro) {
    return {
      somenteLeitura: false,
      motivo: `não consegui conferir os privilégios do usuário: ${
        erro instanceof Error ? erro.message : String(erro)
      }`,
    };
  } finally {
    await sessao.encerrar().catch(() => undefined);
  }
}
