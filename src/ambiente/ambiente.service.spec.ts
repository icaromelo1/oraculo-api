import { Repository } from 'typeorm';
import { OraculoConfig } from '../config/config.service';
import { ConfiguracaoService } from '../config/configuracao.service';
import { Documento } from '../database/entities';
import { AmbienteService } from './ambiente.service';

const ULTIMA_INDEXACAO = new Date('2026-08-01T10:00:00.000Z');

interface ConstrutorFalso {
  select: () => ConstrutorFalso;
  addSelect: () => ConstrutorFalso;
  groupBy: () => ConstrutorFalso;
  addGroupBy: () => ConstrutorFalso;
  orderBy: () => ConstrutorFalso;
  getRawMany: () => Promise<Record<string, string>[]>;
}

function documentosFalsos(): Repository<Documento> {
  const construtor: ConstrutorFalso = {
    select: () => construtor,
    addSelect: () => construtor,
    groupBy: () => construtor,
    addGroupBy: () => construtor,
    orderBy: () => construtor,
    getRawMany: () =>
      Promise.resolve([
        { fonte: 'memoria', autoridade: '1', documentos: '12' },
        { fonte: 'doc', autoridade: '2', documentos: '30' },
      ]),
  };

  return {
    createQueryBuilder: () => construtor,
    findOne: () =>
      Promise.resolve({ atualizadoEm: ULTIMA_INDEXACAO } as Documento),
  } as unknown as Repository<Documento>;
}

function configuracaoFalsa(): ConfiguracaoService {
  return {
    capacidadesEfetivas: () =>
      Promise.resolve([
        { capacidade: 'conhecimento', ligada: true, tetoDoEnv: true },
        {
          capacidade: 'banco',
          ligada: false,
          tetoDoEnv: false,
          motivoIndisponivel: 'CAP_BANCO=off no .env desta instalação',
        },
      ]),
    fontesEfetivas: () =>
      Promise.resolve([
        {
          id: null,
          caminho: '/corpus/memoria',
          rotulo: 'memoria',
          origem: 'env',
          removivel: false,
        },
      ]),
    alvosBanco: () =>
      Promise.resolve([
        {
          id: 'a1',
          nome: 'producao',
          schemas: ['public'],
          colunasMascaradas: [],
          ativo: true,
          criadoEm: ULTIMA_INDEXACAO,
          conexao: {
            host: '10.0.•.•',
            porta: '5432',
            base: 'producao',
            usuario: 'oraculo',
          },
        },
      ]),
    servicosObservaveis: () => Promise.resolve([]),
  } as unknown as ConfiguracaoService;
}

function configFalsa(): OraculoConfig {
  return {
    provedor: {
      tipo: 'cli',
      cliComando: 'agy',
      cliModelo: 'gemini-3.6-flash-medium',
    },
  } as unknown as OraculoConfig;
}

describe('AmbienteService', () => {
  it('consolida o estado do ambiente', async () => {
    const servico = new AmbienteService(
      configFalsa(),
      configuracaoFalsa(),
      documentosFalsos(),
    );

    const estado = await servico.estado();

    expect(estado.corpus).toEqual({
      total: 42,
      porFonte: [
        { fonte: 'memoria', autoridade: 1, documentos: 12 },
        { fonte: 'doc', autoridade: 2, documentos: 30 },
      ],
    });
    expect(estado.provedor).toEqual({
      tipo: 'cli',
      modelo: 'gemini-3.6-flash-medium',
    });
    expect(estado.ultimaIndexacao).toEqual(ULTIMA_INDEXACAO);
    expect(estado.fontes[0]).toMatchObject({
      origem: 'env',
      removivel: false,
    });
    expect(estado.capacidades[1].motivoIndisponivel).toContain('CAP_BANCO=off');
  });

  it('não devolve credencial de alvo de banco em nenhum ponto da resposta', async () => {
    const servico = new AmbienteService(
      configFalsa(),
      configuracaoFalsa(),
      documentosFalsos(),
    );

    const estado = await servico.estado();
    const serializado = JSON.stringify(estado);

    expect(serializado).not.toContain('postgres://');
    expect(serializado).not.toMatch(/senha|password/i);
    expect(estado.alvosBanco[0]).not.toHaveProperty('url');
    expect(estado.alvosBanco[0].conexao.host).toBe('10.0.•.•');
  });
});
