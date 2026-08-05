import { OraculoConfig } from '../../config/config.service';
import {
  ConfiguracaoService,
  type AlvoBancoResumido,
} from '../../config/configuracao.service';
import { RedactionService } from '../../security/redaction.service';
import { SanitizadorDiagnostico } from '../../security/sanitizador-diagnostico';
import type { ResultadoCapacidade } from '../capacidade';
import { ConsultarBancoCapacidade } from './consultar-banco.capacidade';
import { ExecutorConsulta } from './executor-consulta.service';
import { criarSessaoFalsa, type RoteiroSessao } from './sessao-falsa';

const URL = 'postgres://leitor:s3nh4@10.0.0.9:5432/base';

interface AlvoFalso {
  nome: string;
  schemas?: string[];
  colunasMascaradas?: string[];
  ativo?: boolean;
}

interface Cenario {
  banco?: boolean;
  ligadaNoBanco?: boolean;
  bancosNoEnv?: string[];
  alvos?: AlvoFalso[];
  roteiro?: RoteiroSessao;
  urlNula?: boolean;
}

function alvoResumido(falso: AlvoFalso): AlvoBancoResumido {
  return {
    id: `id-${falso.nome}`,
    nome: falso.nome,
    schemas: falso.schemas ?? ['public'],
    colunasMascaradas: falso.colunasMascaradas ?? [],
    ativo: falso.ativo ?? true,
    criadoEm: new Date('2026-01-01T00:00:00.000Z'),
    conexao: {} as AlvoBancoResumido['conexao'],
  };
}

function montar(cenario: Cenario = {}) {
  const alvos = (cenario.alvos ?? [{ nome: 'oraculo' }]).map(alvoResumido);

  const config = {
    capacidades: {
      conhecimento: true,
      codigo: true,
      estado: false,
      banco: cenario.banco ?? true,
    },
    escopos: {
      repos: [],
      comandos: [],
      bancos: cenario.bancosNoEnv ?? alvos.map((alvo) => alvo.nome),
    },
  } as unknown as OraculoConfig;

  const configuracao = {
    capacidadeLigada: () => cenario.ligadaNoBanco ?? true,
    alvosBanco: () => Promise.resolve(alvos.filter((alvo) => alvo.ativo)),
    urlDoAlvo: (nome: string) => {
      const alvo = alvos.find((item) => item.nome === nome && item.ativo);

      return Promise.resolve(alvo && !cenario.urlNula ? URL : null);
    },
  } as unknown as ConfiguracaoService;

  const falsa = criarSessaoFalsa(cenario.roteiro);

  const capacidade = new ConsultarBancoCapacidade(
    new ExecutorConsulta(falsa.abridor),
    new SanitizadorDiagnostico(new RedactionService()),
    config,
    configuracao,
  );

  return { capacidade, falsa };
}

function conteudo(resultado: ResultadoCapacidade): string {
  return resultado.retornos.map((retorno) => retorno.conteudo).join('\n');
}

describe('ConsultarBancoCapacidade', () => {
  it('é sensível e vive sob a chave de env do banco', () => {
    const { capacidade } = montar();

    expect(capacidade.nome).toBe('consultar_banco');
    expect(capacidade.sensivel).toBe(true);
    expect(capacidade.chaveEnv).toBe('banco');
  });

  describe('teto do ENV e recorte do banco', () => {
    it('recusa tudo quando CAP_BANCO=off, sem abrir conexão', async () => {
      const { capacidade, falsa } = montar({ banco: false });
      const resultado = await capacidade.executar({
        alvo: 'oraculo',
        sql: 'SELECT 1',
      });

      expect(resultado.metrica).toContain('CAP_BANCO=off');
      expect(falsa.urls).toEqual([]);
    });

    it('recusa quando o banco desligou a capacidade, mesmo com o env ligado', async () => {
      const { capacidade, falsa } = montar({ ligadaNoBanco: false });
      const resultado = await capacidade.executar({
        alvo: 'oraculo',
        sql: 'SELECT 1',
      });

      expect(resultado.metrica).toContain('desligada na configuração');
      expect(falsa.urls).toEqual([]);
    });
  });

  describe('alvo', () => {
    it('recusa alvo que não está em BANCO_ALVOS', async () => {
      const { capacidade, falsa } = montar({ bancosNoEnv: ['outro'] });
      const resultado = await capacidade.executar({
        alvo: 'oraculo',
        sql: 'SELECT 1',
      });

      expect(resultado.metrica).toContain('BANCO_ALVOS');
      expect(falsa.urls).toEqual([]);
    });

    it('recusa alvo liberado no env mas não cadastrado no banco', async () => {
      const { capacidade, falsa } = montar({
        bancosNoEnv: ['oraculo', 'producao'],
        alvos: [{ nome: 'oraculo' }],
      });
      const resultado = await capacidade.executar({
        alvo: 'producao',
        sql: 'SELECT 1',
      });

      expect(resultado.metrica).toContain('não está cadastrado e ativo');
      expect(falsa.urls).toEqual([]);
    });

    it('recusa alvo cadastrado porém inativo', async () => {
      const { capacidade, falsa } = montar({
        alvos: [{ nome: 'oraculo', ativo: false }],
        bancosNoEnv: ['oraculo'],
      });
      const resultado = await capacidade.executar({
        alvo: 'oraculo',
        sql: 'SELECT 1',
      });

      expect(resultado.metrica).toContain('não está cadastrado e ativo');
      expect(falsa.urls).toEqual([]);
    });

    it('recusa nome de alvo inventado pelo modelo, em qualquer forma', async () => {
      const { capacidade, falsa } = montar();

      for (const alvo of [
        undefined,
        null,
        '',
        '   ',
        42,
        ['oraculo'],
        {},
        'oraculo; drop',
        'ORACULO',
        '../oraculo',
      ]) {
        const resultado = await capacidade.executar({ alvo, sql: 'SELECT 1' });

        expect(resultado.volume).toBe(0);
        expect(resultado.retornos).toEqual([]);
      }

      expect(falsa.urls).toEqual([]);
    });

    it('recusa alvo cadastrado sem schema declarado', async () => {
      const { capacidade, falsa } = montar({
        alvos: [{ nome: 'oraculo', schemas: [] }],
      });
      const resultado = await capacidade.executar({
        alvo: 'oraculo',
        sql: 'SELECT 1',
      });

      expect(resultado.metrica).toContain('não declara nenhum schema');
      expect(falsa.urls).toEqual([]);
    });

    it('recusa quando a URL cifrada não pode ser decifrada', async () => {
      const { capacidade, falsa } = montar({ urlNula: true });
      const resultado = await capacidade.executar({
        alvo: 'oraculo',
        sql: 'SELECT 1',
      });

      expect(resultado.metrica).toContain('recadastre o alvo');
      expect(falsa.urls).toEqual([]);
    });
  });

  describe('SQL adversarial — nada disso chega no driver', () => {
    const ataques = [
      'SELECT 1; DROP TABLE x',
      'WITH t AS (DELETE FROM x RETURNING *) SELECT * FROM t',
      "SELECT pg_read_file('/etc/passwd')",
      "SELECT * FROM dblink('host=evil', 'select 1') AS t(x text)",
      "COPY x TO PROGRAM 'sh'",
      'SELECT pg_sleep(60)',
      'UPDATE usuario SET ativo = false',
      'INSERT INTO usuario (nome) VALUES (1)',
      'DELETE FROM usuario',
      'SELECT 1 --\nDROP TABLE x',
      'SELECT/**/1',
      'SeLeCt Pg_SlEeP(60)',
      'SELECT * FROM outro_schema.usuario',
      'SELECT 1 INTO nova FROM public.usuario',
      'DO $$ BEGIN PERFORM pg_sleep(9) ; END $$',
      'SET statement_timeout = 0',
      'GRANT ALL ON usuario TO publico',
      'SELECT * FROM public.usuario FETCH FIRST 100000 ROWS ONLY',
      "SELECT lo_import('/etc/passwd')",
      'ＳＥＬＥＣＴ 1',
    ];

    it.each(ataques)('recusa %s antes de abrir conexão', async (sql) => {
      const { capacidade, falsa } = montar();
      const resultado = await capacidade.executar({ alvo: 'oraculo', sql });

      expect(resultado.retornos).toEqual([]);
      expect(resultado.volume).toBe(0);
      expect(resultado.metrica.startsWith('bloqueado:')).toBe(true);
      expect(falsa.urls).toEqual([]);
      expect(falsa.comandos).toEqual([]);
    });

    it('recusa sql ausente ou que não é texto', async () => {
      const { capacidade, falsa } = montar();

      for (const sql of [undefined, null, '', '   ', 7, {}, ['SELECT 1']]) {
        const resultado = await capacidade.executar({ alvo: 'oraculo', sql });

        expect(resultado.volume).toBe(0);
      }

      expect(falsa.urls).toEqual([]);
    });

    it('não aceita argumento extra inventado pelo modelo', async () => {
      const { capacidade, falsa } = montar();

      await capacidade.executar({
        alvo: 'oraculo',
        sql: 'SELECT 1',
        limite: 100000,
        timeout: 0,
        readOnly: false,
        url: 'postgres://root:root@127.0.0.1/outro',
      });

      expect(falsa.urls).toEqual([URL]);
      expect(JSON.stringify(falsa.comandos)).not.toContain('100000');
      expect(JSON.stringify(falsa.comandos)).not.toContain('root');
    });
  });

  describe('consulta que passa', () => {
    const roteiro: RoteiroSessao = {
      padrao: {
        colunas: ['id', 'nome'],
        linhas: [
          [1, 'Icaro'],
          [2, 'Isabelle'],
        ],
      },
    };

    it('impõe o LIMIT no SQL que chega no servidor', async () => {
      const { capacidade, falsa } = montar({ roteiro });
      const resultado = await capacidade.executar({
        alvo: 'oraculo',
        sql: 'SELECT id, nome FROM public.usuario LIMIT 100000',
      });

      expect(falsa.comandos).toContain(
        'SELECT id, nome FROM public.usuario LIMIT 100',
      );
      expect(falsa.comandos).not.toContain(
        'SELECT id, nome FROM public.usuario LIMIT 100000',
      );
      expect(resultado.plano).toBe(
        'SELECT id, nome FROM public.usuario LIMIT 100',
      );
    });

    it('acrescenta LIMIT quando o modelo não põe nenhum', async () => {
      const { capacidade, falsa } = montar({ roteiro });

      await capacidade.executar({
        alvo: 'oraculo',
        sql: 'SELECT id, nome FROM public.usuario',
      });

      expect(falsa.comandos).toContain(
        'SELECT id, nome FROM public.usuario LIMIT 100',
      );
    });

    it('devolve as linhas em formato coluna=valor com métrica e origem', async () => {
      const { capacidade } = montar({ roteiro });
      const resultado = await capacidade.executar({
        alvo: 'oraculo',
        sql: 'SELECT id, nome FROM public.usuario',
      });

      expect(resultado.volume).toBe(2);
      expect(resultado.metrica).toBe('consulta em oraculo: 2 linha(s)');
      expect(resultado.retornos[0].origem).toMatchObject({
        ferramenta: 'consultar_banco',
        tipo: 'banco',
        caminho: 'banco://oraculo/consulta',
      });
      expect(conteudo(resultado)).toContain('id=1\tnome=Icaro');
    });
  });

  describe('mascaramento e sanitização', () => {
    it('o valor da coluna mascarada não sobrevive ao retorno', async () => {
      const { capacidade } = montar({
        alvos: [{ nome: 'oraculo', colunasMascaradas: ['senha'] }],
        roteiro: {
          padrao: {
            colunas: ['id', 'senha'],
            linhas: [[1, 'argon2-do-icaro-em-claro']],
          },
        },
      });

      const resultado = await capacidade.executar({
        alvo: 'oraculo',
        sql: 'SELECT * FROM public.usuario',
      });

      expect(conteudo(resultado)).not.toContain('argon2-do-icaro-em-claro');
      expect(conteudo(resultado)).toMatch(/senha=\[(mascarado|oculto:senha)\]/);
      expect(conteudo(resultado)).toContain('senha (mascarada)');
      expect(conteudo(resultado)).toContain('id=1');
    });

    it('valor de coluna sensível some mesmo sem estar em colunasMascaradas', async () => {
      const { capacidade } = montar({
        roteiro: {
          padrao: {
            colunas: ['id', 'senha'],
            linhas: [[1, 'argon2-do-icaro-em-claro']],
          },
        },
      });

      const resultado = await capacidade.executar({
        alvo: 'oraculo',
        sql: 'SELECT * FROM public.usuario',
      });

      expect(conteudo(resultado)).not.toContain('argon2-do-icaro-em-claro');
      expect(conteudo(resultado)).toContain('[oculto:senha]');
    });

    it('recusa a consulta que tenta apelidar a coluna mascarada', async () => {
      const { capacidade, falsa } = montar({
        alvos: [{ nome: 'oraculo', colunasMascaradas: ['senha'] }],
      });

      for (const sql of [
        'SELECT senha AS x FROM public.usuario',
        'SELECT md5(senha) FROM public.usuario',
        "SELECT id FROM public.usuario WHERE senha = 'a'",
        'SELECT * FROM (SELECT senha AS x FROM public.usuario) q',
      ]) {
        const resultado = await capacidade.executar({ alvo: 'oraculo', sql });

        expect(resultado.volume).toBe(0);
        expect(resultado.metrica).toContain('mascarada');
      }

      expect(falsa.comandos).toEqual([]);
    });

    it('o sanitizador roda sobre o dado que veio do banco', async () => {
      const { capacidade } = montar({
        roteiro: {
          padrao: {
            colunas: ['email', 'cpf', 'origem', 'token'],
            linhas: [
              [
                'icaro@exemplo.com.br',
                '529.982.247-25',
                '10.0.0.5',
                'Bearer abcdefghijklmnopqrstuvwx',
              ],
            ],
          },
        },
      });

      const resultado = await capacidade.executar({
        alvo: 'oraculo',
        sql: 'SELECT * FROM public.usuario',
      });
      const texto = conteudo(resultado);

      expect(texto).not.toContain('icaro@exemplo.com.br');
      expect(texto).not.toContain('529.982.247-25');
      expect(texto).not.toContain('10.0.0.5');
      expect(texto).not.toContain('abcdefghijklmnopqrstuvwx');
      expect(texto).toContain('[oculto:email]');
      expect(texto).toContain('[oculto:cpf]');
    });

    it('a mensagem de erro do servidor também é sanitizada', async () => {
      const { capacidade } = montar({
        roteiro: {
          falharEm: /^EXPLAIN/,
        },
      });

      const resultado = await capacidade.executar({
        alvo: 'oraculo',
        sql: "SELECT * FROM public.usuario WHERE email = 'x'",
      });

      expect(resultado.volume).toBe(0);
      expect(resultado.metrica).toBe('falha em oraculo');
      expect(resultado.retornos[0].origem.caminho).toBe('banco://oraculo');
    });
  });

  describe('descrever schema', () => {
    const roteiro: RoteiroSessao = {
      padrao: {
        colunas: [
          'table_schema',
          'table_name',
          'column_name',
          'data_type',
          'is_nullable',
        ],
        linhas: [
          ['public', 'usuario', 'id', 'uuid', 'NO'],
          ['public', 'usuario', 'senha', 'text', 'YES'],
        ],
      },
    };

    it('lista tabela e coluna sem exigir SQL do modelo', async () => {
      const { capacidade } = montar({
        roteiro,
        alvos: [{ nome: 'oraculo', colunasMascaradas: ['senha'] }],
      });

      const resultado = await capacidade.executar({
        alvo: 'oraculo',
        operacao: 'descrever_schema',
      });

      expect(resultado.volume).toBe(2);
      expect(conteudo(resultado)).toContain('public.usuario:');
      expect(conteudo(resultado)).toContain('senha text null (mascarada)');
      expect(resultado.retornos[0].origem.caminho).toBe(
        'banco://oraculo/schema',
      );
    });

    it('recusa nome de tabela fora do formato, sem conectar', async () => {
      const { capacidade, falsa } = montar({ roteiro });

      for (const tabela of [
        'usuario; drop table x',
        "usuario' OR '1'='1",
        'public.usuario',
        '../etc',
        'usuário',
      ]) {
        const resultado = await capacidade.executar({
          alvo: 'oraculo',
          operacao: 'descrever_schema',
          tabela,
        });

        expect(resultado.volume).toBe(0);
      }

      expect(falsa.urls).toEqual([]);
    });

    it('ignora o sql quando a operação é descrever_schema', async () => {
      const { capacidade, falsa } = montar({ roteiro });

      await capacidade.executar({
        alvo: 'oraculo',
        operacao: 'descrever_schema',
        sql: 'DROP TABLE usuario',
      });

      expect(JSON.stringify(falsa.comandos)).not.toContain('DROP');
    });
  });

  describe('operação', () => {
    it('recusa operação fora do catálogo', async () => {
      const { capacidade, falsa } = montar();

      for (const operacao of [
        'executar',
        'escrever',
        'DESCREVER_SCHEMA',
        42,
        {},
        ['consultar'],
        '__proto__',
      ]) {
        const resultado = await capacidade.executar({
          alvo: 'oraculo',
          operacao,
          sql: 'SELECT 1',
        });

        expect(resultado.volume).toBe(0);
        expect(resultado.metrica).toContain('operação fora do catálogo');
      }

      expect(falsa.urls).toEqual([]);
    });

    it('trata a ausência de operação como consultar', async () => {
      const { capacidade, falsa } = montar();

      await capacidade.executar({ alvo: 'oraculo', sql: 'SELECT 1' });

      expect(falsa.comandos).toContain('SELECT 1 LIMIT 100');
    });
  });
});
