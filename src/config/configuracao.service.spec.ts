import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import {
  AlvoBanco,
  CapacidadeInstalacao,
  FonteConhecimento,
  ServicoObservavel,
} from '../database/entities';
import { SecurityService } from '../security/security.service';
import { CifraService } from './cifra.service';
import { OraculoConfig } from './config.service';
import { ConfiguracaoService } from './configuracao.service';

interface ComId {
  id?: string;
}

function criarRepositorio<T extends ComId>(inicial: T[] = []) {
  const dados: T[] = inicial.map((item) => ({
    id: item.id ?? randomUUID(),
    ...item,
  }));

  const casa = (item: T, where: Record<string, unknown>) =>
    Object.entries(where).every(
      ([chave, valor]) => (item as Record<string, unknown>)[chave] === valor,
    );

  return {
    find: jest.fn(() => Promise.resolve(dados.map((item) => ({ ...item })))),
    findOne: jest.fn((opcoes: { where?: Record<string, unknown> }) =>
      Promise.resolve(
        dados.find((item) => casa(item, opcoes.where ?? {})) ?? null,
      ),
    ),
    create: jest.fn((dado: Partial<T>) => ({ ...dado }) as T),
    save: jest.fn((dado: T) => {
      const indice = dados.findIndex((item) => item.id && item.id === dado.id);

      if (indice >= 0) {
        dados[indice] = { ...dados[indice], ...dado };

        return Promise.resolve({ ...dados[indice] });
      }

      const novo = { ...dado, id: dado.id ?? randomUUID() } as T;
      dados.push(novo);

      return Promise.resolve({ ...novo });
    }),
    delete: jest.fn((criterio: Record<string, unknown>) => {
      const indice = dados.findIndex((item) => casa(item, criterio));

      if (indice >= 0) {
        dados.splice(indice, 1);
      }

      return Promise.resolve({ affected: indice >= 0 ? 1 : 0 });
    }),
    dados,
  };
}

type RepositorioFalso<T extends ComId> = ReturnType<typeof criarRepositorio<T>>;

interface Tetos {
  conhecimento?: boolean;
  codigo?: boolean;
  estado?: boolean;
  banco?: boolean;
  fontes?: string[];
  bancos?: string[];
}

function configFalsa(tetos: Tetos = {}): OraculoConfig {
  return {
    capacidades: {
      conhecimento: tetos.conhecimento ?? true,
      codigo: tetos.codigo ?? true,
      estado: tetos.estado ?? false,
      banco: tetos.banco ?? false,
    },
    corpus: {
      fontes: tetos.fontes ?? ['/corpus/memoria', '/corpus/docs'],
      negados: [],
      exibicao: [],
    },
    escopos: {
      repos: [],
      comandos: [],
      bancos: tetos.bancos ?? ['producao'],
    },
    segredoDeConfiguracao: 'segredo-de-teste-com-32-caracteres-ok',
  } as unknown as OraculoConfig;
}

interface Montagem {
  servico: ConfiguracaoService;
  capacidades: RepositorioFalso<CapacidadeInstalacao>;
  fontes: RepositorioFalso<FonteConhecimento>;
  alvos: RepositorioFalso<AlvoBanco>;
  servicos: RepositorioFalso<ServicoObservavel>;
  registrar: jest.Mock;
}

function montar(
  tetos: Tetos = {},
  sementes: {
    capacidades?: Partial<CapacidadeInstalacao>[];
    fontes?: Partial<FonteConhecimento>[];
    alvos?: Partial<AlvoBanco>[];
    servicos?: Partial<ServicoObservavel>[];
  } = {},
): Montagem {
  const config = configFalsa(tetos);
  const cifra = new CifraService(config);
  const registrar = jest.fn().mockResolvedValue(null);
  const seguranca = { registrar } as unknown as SecurityService;

  const capacidades = criarRepositorio(
    (sementes.capacidades ?? []) as CapacidadeInstalacao[],
  );
  const fontes = criarRepositorio(
    (sementes.fontes ?? []) as FonteConhecimento[],
  );
  const alvos = criarRepositorio((sementes.alvos ?? []) as AlvoBanco[]);
  const servicos = criarRepositorio(
    (sementes.servicos ?? []) as ServicoObservavel[],
  );

  const servico = new ConfiguracaoService(
    config,
    cifra,
    seguranca,
    capacidades as unknown as Repository<CapacidadeInstalacao>,
    fontes as unknown as Repository<FonteConhecimento>,
    alvos as unknown as Repository<AlvoBanco>,
    servicos as unknown as Repository<ServicoObservavel>,
  );

  return { servico, capacidades, fontes, alvos, servicos, registrar };
}

describe('ConfiguracaoService — o ENV é o teto, o banco é o recorte', () => {
  it('recusa ligar capacidade que o ENV proíbe', async () => {
    const { servico, capacidades } = montar({ banco: false });

    await expect(servico.definirCapacidade('banco', true)).rejects.toThrow(
      /CAP_BANCO=off/,
    );
    expect(capacidades.save).not.toHaveBeenCalled();
  });

  it('devolve indisponível com motivo quando o ENV proíbe', async () => {
    const { servico } = montar({ banco: false });
    const banco = (await servico.capacidadesEfetivas()).find(
      (item) => item.capacidade === 'banco',
    );

    expect(banco).toEqual({
      capacidade: 'banco',
      ligada: false,
      tetoDoEnv: false,
      motivoIndisponivel: 'CAP_BANCO=off no .env desta instalação',
    });
  });

  it('ignora linha do banco que tenta ligar o que o ENV proíbe', async () => {
    const { servico } = montar(
      { banco: false },
      { capacidades: [{ capacidade: 'banco', ligada: true } as never] },
    );

    const banco = (await servico.capacidadesEfetivas()).find(
      (item) => item.capacidade === 'banco',
    );

    expect(banco?.ligada).toBe(false);
    expect(banco?.motivoIndisponivel).toContain('CAP_BANCO=off');
    expect(servico.capacidadeLigada('banco')).toBe(false);
  });

  it('deixa o banco desligar o que o ENV permite', async () => {
    const { servico } = montar({ codigo: true });

    await servico.definirCapacidade('codigo', false, 'usuario-1');

    const codigo = (await servico.capacidadesEfetivas()).find(
      (item) => item.capacidade === 'codigo',
    );

    expect(codigo?.ligada).toBe(false);
    expect(codigo?.tetoDoEnv).toBe(true);
    expect(codigo?.motivoIndisponivel).toBe(
      'desligada na configuração do Oráculo',
    );
    expect(servico.capacidadeLigada('codigo')).toBe(false);
  });

  it('sem linha no banco, a capacidade espelha o teto do ENV', async () => {
    const { servico } = montar({ estado: false, conhecimento: true });
    const efetivas = await servico.capacidadesEfetivas();

    expect(
      efetivas.find((item) => item.capacidade === 'conhecimento')?.ligada,
    ).toBe(true);
    expect(efetivas.find((item) => item.capacidade === 'estado')?.ligada).toBe(
      false,
    );
  });

  it('recusa capacidade fora do catálogo', async () => {
    const { servico } = montar();

    await expect(servico.definirCapacidade('shell', true)).rejects.toThrow(
      /não existe/,
    );
  });
});

describe('ConfiguracaoService — cache', () => {
  it('lê o banco uma vez só e reaproveita', async () => {
    const { servico, capacidades } = montar();

    await servico.capacidadesEfetivas();
    await servico.capacidadesEfetivas();
    await servico.fontesEfetivas();

    expect(capacidades.find).toHaveBeenCalledTimes(1);
  });

  it('invalida o cache em toda escrita', async () => {
    const { servico, capacidades } = montar({ codigo: true });

    await servico.capacidadesEfetivas();
    expect(capacidades.find).toHaveBeenCalledTimes(1);

    await servico.definirCapacidade('codigo', false, 'usuario-1');

    expect(capacidades.find.mock.calls.length).toBeGreaterThan(1);
    expect(servico.capacidadeLigada('codigo')).toBe(false);
  });
});

describe('ConfiguracaoService — fontes', () => {
  it('marca a fonte do ENV como não removível e soma as do banco', async () => {
    const { servico } = montar(
      { fontes: ['/corpus/memoria'] },
      {
        fontes: [
          {
            caminho: '/corpus/extra',
            rotulo: 'Extra',
            ativa: true,
          },
        ],
      },
    );

    const fontes = await servico.fontesEfetivas();

    expect(fontes).toEqual([
      expect.objectContaining({
        caminho: '/corpus/memoria',
        origem: 'env',
        removivel: false,
      }),
      expect.objectContaining({
        caminho: '/corpus/extra',
        origem: 'banco',
        removivel: true,
      }),
    ]);
  });

  it('não deixa o banco duplicar nem sobrepor uma fonte do ENV', async () => {
    const { servico } = montar(
      { fontes: ['/corpus/memoria'] },
      {
        fontes: [
          {
            caminho: '/corpus/memoria',
            rotulo: 'tentando sobrepor',
            ativa: true,
          },
        ],
      },
    );

    const fontes = await servico.fontesEfetivas();

    expect(fontes).toHaveLength(1);
    expect(fontes[0].origem).toBe('env');
    expect(fontes[0].removivel).toBe(false);
  });

  it('não traz fonte do banco marcada como inativa', async () => {
    const { servico } = montar(
      { fontes: [] },
      {
        fontes: [{ caminho: '/corpus/off', rotulo: 'Off', ativa: false }],
      },
    );

    expect(await servico.fontesEfetivas()).toEqual([]);
  });
});

describe('ConfiguracaoService — alvos de banco', () => {
  const url = 'postgres://oraculo:senhaSuperSecreta@10.0.0.7:5432/producao';

  it('recusa criar alvo quando o ENV desliga a capacidade', async () => {
    const { servico, alvos } = montar({ banco: false });

    await expect(
      servico.criarAlvoBanco({ nome: 'producao', url }),
    ).rejects.toThrow(/CAP_BANCO=off/);
    expect(alvos.save).not.toHaveBeenCalled();
  });

  it('recusa alvo fora de BANCO_ALVOS', async () => {
    const { servico } = montar({ banco: true, bancos: ['producao'] });

    await expect(
      servico.criarAlvoBanco({ nome: 'outro-banco', url }),
    ).rejects.toThrow(/BANCO_ALVOS/);
  });

  it('nunca devolve a credencial, só o resumo da conexão', async () => {
    const { servico, alvos } = montar({ banco: true, bancos: ['producao'] });

    const criado = await servico.criarAlvoBanco(
      { nome: 'producao', url, schemas: ['public'] },
      'usuario-1',
    );

    expect(JSON.stringify(criado)).not.toContain('senhaSuperSecreta');
    expect(JSON.stringify(criado)).not.toContain('10.0.0.7');
    expect(criado).not.toHaveProperty('url');
    expect(criado.conexao.usuario).toBe('oraculo');
    expect(criado.conexao.base).toBe('producao');

    const listados = await servico.alvosBanco();

    expect(JSON.stringify(listados)).not.toContain('senhaSuperSecreta');
    expect(alvos.dados[0].url).not.toContain('senhaSuperSecreta');
  });

  it('guarda a url cifrada e devolve decifrada só por dentro', async () => {
    const { servico } = montar({ banco: true, bancos: ['producao'] });

    await servico.criarAlvoBanco({ nome: 'producao', url });

    expect(await servico.urlDoAlvo('producao')).toBe(url);
  });

  it('não lista alvo quando a capacidade está desligada na configuração', async () => {
    const { servico } = montar({ banco: true, bancos: ['producao'] });

    await servico.criarAlvoBanco({ nome: 'producao', url });
    await servico.definirCapacidade('banco', false, 'usuario-1');

    expect(await servico.alvosBanco()).toEqual([]);
    expect(await servico.urlDoAlvo('producao')).toBeNull();
  });

  it('remove alvo existente e recusa id desconhecido', async () => {
    const { servico, alvos } = montar({ banco: true, bancos: ['producao'] });
    const criado = await servico.criarAlvoBanco({ nome: 'producao', url });

    await servico.removerAlvoBanco(criado.id, 'usuario-1');

    expect(alvos.dados).toHaveLength(0);
    await expect(servico.removerAlvoBanco('inexistente')).rejects.toThrow(
      /não existe/,
    );
  });
});

describe('ConfiguracaoService — serviços observáveis', () => {
  it('recusa criar serviço quando o ENV desliga a capacidade', async () => {
    const { servico } = montar({ estado: false });

    await expect(
      servico.criarServico({ nome: 'base-api', rotulo: 'Base API' }),
    ).rejects.toThrow(/CAP_ESTADO=off/);
  });

  it('cria, lista e remove serviço quando o ENV permite', async () => {
    const { servico } = montar({ estado: true });

    const criado = await servico.criarServico(
      { nome: 'base-api', rotulo: 'Base API' },
      'usuario-1',
    );

    expect(await servico.servicosObservaveis()).toEqual([
      expect.objectContaining({ nome: 'base-api', rotulo: 'Base API' }),
    ]);

    await servico.removerServico(criado.id, 'usuario-1');

    expect(await servico.servicosObservaveis()).toEqual([]);
  });
});

function registroDe(
  registrar: jest.Mock,
  indice: number,
): Record<string, unknown> {
  const chamadas = registrar.mock.calls as unknown[][];

  return chamadas[indice][0] as Record<string, unknown>;
}

describe('ConfiguracaoService — auditoria', () => {
  it('registra quem mudou, o quê e o valor anterior', async () => {
    const { servico, registrar } = montar({ codigo: true });

    await servico.definirCapacidade('codigo', false, 'usuario-1');

    expect(registrar).toHaveBeenCalledTimes(1);

    const registro = registroDe(registrar, 0);

    expect(registro.usuarioId).toBe('usuario-1');
    expect(registro.tom).toBe('configuracao');
    expect(registro.resultado).toBe(
      'capacidade "codigo" passou de ligada para desligada',
    );
    expect(registro.ferramentas).toEqual([
      {
        nome: 'ambiente.capacidade',
        argumento: { capacidade: 'codigo', ligada: false },
        status: 'aplicada',
      },
    ]);
  });

  it('registra criação e remoção de alvo de banco sem vazar a url', async () => {
    const { servico, registrar } = montar({
      banco: true,
      bancos: ['producao'],
    });
    const url = 'postgres://oraculo:senhaSuperSecreta@10.0.0.7:5432/producao';

    const criado = await servico.criarAlvoBanco({ nome: 'producao', url });
    await servico.removerAlvoBanco(criado.id, 'usuario-1');

    expect(registrar).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(registrar.mock.calls)).not.toContain(
      'senhaSuperSecreta',
    );
    expect(registroDe(registrar, 1).resultado).toBe(
      'alvo de banco "producao" removido (antes: ativo)',
    );
  });

  it('registra criação e remoção de serviço observável', async () => {
    const { servico, registrar } = montar({ estado: true });

    const criado = await servico.criarServico({
      nome: 'base-api',
      rotulo: 'Base API',
    });
    await servico.removerServico(criado.id, 'usuario-1');

    expect(registrar).toHaveBeenCalledTimes(2);
    expect(registroDe(registrar, 0).resultado).toBe(
      'serviço observável "base-api" criado (antes: inexistente)',
    );
  });
});
