import { TIMEOUT_CONSULTA_MS } from './conexao';
import { ExecutorConsulta } from './executor-consulta.service';
import { criarSessaoFalsa, type RoteiroSessao } from './sessao-falsa';

const URL = 'postgres://leitor:segredo@10.0.0.9:5432/base';

function montar(roteiro: RoteiroSessao = {}) {
  const falsa = criarSessaoFalsa(roteiro);

  return { falsa, executor: new ExecutorConsulta(falsa.abridor) };
}

describe('ExecutorConsulta — a sessão nasce presa', () => {
  it('abre transação somente leitura, timeout e search_path antes de qualquer consulta', async () => {
    const { falsa, executor } = montar();

    await executor.consultar({
      url: URL,
      schemas: ['public', 'app'],
      sql: 'SELECT 1 LIMIT 100',
      teto: 100,
    });

    expect(falsa.comandos.slice(0, 4)).toEqual([
      'BEGIN TRANSACTION READ ONLY',
      `SET LOCAL statement_timeout = ${TIMEOUT_CONSULTA_MS}`,
      `SET LOCAL idle_in_transaction_session_timeout = ${TIMEOUT_CONSULTA_MS}`,
      'SET LOCAL search_path = "public", "app"',
    ]);
  });

  it('roda EXPLAIN antes da consulta de verdade', async () => {
    const { falsa, executor } = montar();

    await executor.consultar({
      url: URL,
      schemas: ['public'],
      sql: 'SELECT 1 LIMIT 100',
      teto: 100,
    });

    expect(falsa.comandos[4]).toBe('EXPLAIN SELECT 1 LIMIT 100');
    expect(falsa.comandos[5]).toBe('SELECT 1 LIMIT 100');
  });

  it('não executa a consulta quando o EXPLAIN falha', async () => {
    const { falsa, executor } = montar({ falharEm: /^EXPLAIN/ });

    const resultado = await executor.consultar({
      url: URL,
      schemas: ['public'],
      sql: 'SELECT * FROM inexistente LIMIT 100',
      teto: 100,
    });

    expect(resultado.ok).toBe(false);
    expect(falsa.comandos).not.toContain('SELECT * FROM inexistente LIMIT 100');
  });

  it('sempre dá ROLLBACK e encerra, mesmo quando a consulta explode', async () => {
    const { falsa, executor } = montar({ falharEm: /inexistente/ });

    await executor.consultar({
      url: URL,
      schemas: ['public'],
      sql: 'SELECT * FROM inexistente LIMIT 100',
      teto: 100,
    });

    expect(falsa.comandos.at(-1)).toBe('ROLLBACK');
    expect(falsa.encerrada).toBe(true);
  });

  it('encerra a sessão também no caminho feliz', async () => {
    const { falsa, executor } = montar();

    await executor.consultar({
      url: URL,
      schemas: ['public'],
      sql: 'SELECT 1 LIMIT 100',
      teto: 100,
    });

    expect(falsa.comandos.at(-1)).toBe('ROLLBACK');
    expect(falsa.encerrada).toBe(true);
  });

  it('devolve erro legível quando nem conecta, sem abrir transação', async () => {
    const { falsa, executor } = montar({ erroDeConexao: 'ECONNREFUSED' });

    const resultado = await executor.consultar({
      url: URL,
      schemas: ['public'],
      sql: 'SELECT 1 LIMIT 100',
      teto: 100,
    });

    expect(resultado.ok).toBe(false);
    expect(resultado.ok ? '' : resultado.erro).toContain(
      'não foi possível conectar',
    );
    expect(falsa.comandos).toEqual([]);
  });

  it('corta as linhas no teto mesmo se o servidor devolver mais', async () => {
    const { executor } = montar({
      padrao: {
        colunas: ['id'],
        linhas: Array.from({ length: 500 }, (_, indice) => [indice]),
      },
    });

    const resultado = await executor.consultar({
      url: URL,
      schemas: ['public'],
      sql: 'SELECT id FROM public.t LIMIT 10',
      teto: 10,
    });

    expect(resultado.ok && resultado.resposta.linhas).toHaveLength(10);
  });
});

describe('ExecutorConsulta — descrição de schema', () => {
  it('lê information_schema com os schemas como parâmetro, nunca interpolados', async () => {
    const { falsa, executor } = montar({
      padrao: {
        colunas: [
          'table_schema',
          'table_name',
          'column_name',
          'data_type',
          'is_nullable',
        ],
        linhas: [['public', 'usuario', 'id', 'uuid', 'NO']],
      },
    });

    const resultado = await executor.descrever({
      url: URL,
      schemas: ['public'],
      tabela: null,
    });

    const consulta = falsa.comandos.at(-2) ?? '';

    expect(consulta).toContain('information_schema.columns');
    expect(consulta).toContain('$1::text[]');
    expect(falsa.parametros.at(-2)).toEqual([['public'], null]);
    expect(resultado.ok && resultado.colunas).toEqual([
      {
        schema: 'public',
        tabela: 'usuario',
        coluna: 'id',
        tipo: 'uuid',
        aceitaNulo: false,
      },
    ]);
  });

  it('passa a tabela pedida como parâmetro', async () => {
    const { falsa, executor } = montar();

    await executor.descrever({
      url: URL,
      schemas: ['public'],
      tabela: 'usuario',
    });

    expect(falsa.parametros.at(-2)).toEqual([['public'], 'usuario']);
  });

  it('descreve também dentro da transação somente leitura', async () => {
    const { falsa, executor } = montar();

    await executor.descrever({ url: URL, schemas: ['app'], tabela: null });

    expect(falsa.comandos[0]).toBe('BEGIN TRANSACTION READ ONLY');
    expect(falsa.comandos.at(-1)).toBe('ROLLBACK');
  });
});
