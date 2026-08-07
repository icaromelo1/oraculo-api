import { randomUUID } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import {
  AlvoBanco,
  CapacidadeInstalacao,
  FonteConhecimento,
  ProvedorModelo,
  ServicoObservavel,
  TipoProvedorModelo,
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

  const gerenciador = {
    update: jest.fn(
      (
        _entidade: unknown,
        criterio: Record<string, unknown>,
        patch: Record<string, unknown>,
      ) => {
        let afetados = 0;

        dados.forEach((item, indice) => {
          if (!casa(item, criterio)) return;

          dados[indice] = { ...item, ...patch };
          afetados += 1;
        });

        return Promise.resolve({ affected: afetados });
      },
    ),
  };

  return {
    manager: {
      transaction: jest.fn(
        (executar: (gerenciador: typeof gerenciador) => Promise<unknown>) =>
          executar(gerenciador),
      ),
    },
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
  provedores?: ('cli' | 'anthropic' | 'openai-compat')[];
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
    provedoresPermitidos: tetos.provedores ?? [
      'openai-compat',
      'cli',
      'anthropic',
    ],
    segredoDeConfiguracao: 'segredo-de-teste-com-32-caracteres-ok',
  } as unknown as OraculoConfig;
}

interface Montagem {
  servico: ConfiguracaoService;
  capacidades: RepositorioFalso<CapacidadeInstalacao>;
  fontes: RepositorioFalso<FonteConhecimento>;
  alvos: RepositorioFalso<AlvoBanco>;
  servicos: RepositorioFalso<ServicoObservavel>;
  modelos: RepositorioFalso<ProvedorModelo>;
  registrar: jest.Mock;
}

function montar(
  tetos: Tetos = {},
  sementes: {
    capacidades?: Partial<CapacidadeInstalacao>[];
    fontes?: Partial<FonteConhecimento>[];
    alvos?: Partial<AlvoBanco>[];
    servicos?: Partial<ServicoObservavel>[];
    modelos?: Partial<ProvedorModelo>[];
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
  const modelos = criarRepositorio(
    (sementes.modelos ?? []) as ProvedorModelo[],
  );

  const servico = new ConfiguracaoService(
    config,
    cifra,
    seguranca,
    capacidades as unknown as Repository<CapacidadeInstalacao>,
    fontes as unknown as Repository<FonteConhecimento>,
    alvos as unknown as Repository<AlvoBanco>,
    servicos as unknown as Repository<ServicoObservavel>,
    modelos as unknown as Repository<ProvedorModelo>,
  );

  return { servico, capacidades, fontes, alvos, servicos, modelos, registrar };
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

describe('ConfiguracaoService — cadastro de fonte', () => {
  let raiz: string;

  beforeEach(async () => {
    raiz = await realpath(await mkdtemp(join(tmpdir(), 'oraculo-fonte-')));
  });

  afterEach(async () => {
    await rm(raiz, { recursive: true, force: true });
  });

  it('cadastra uma pasta que está dentro da raiz permitida', async () => {
    await mkdir(join(raiz, 'anotacoes'));
    const { servico, registrar } = montar({ fontes: [raiz] });

    const fonte = await servico.criarFonte({
      caminho: join(raiz, 'anotacoes'),
    });

    expect(fonte).toMatchObject({
      caminho: join(raiz, 'anotacoes'),
      rotulo: 'anotacoes',
      origem: 'banco',
      removivel: true,
    });
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        ferramentas: [
          expect.objectContaining({ nome: 'ambiente.fonte.criar' }),
        ],
      }),
    );
  });

  it('recusa pasta fora da raiz permitida', async () => {
    const fora = await realpath(await mkdtemp(join(tmpdir(), 'oraculo-fora-')));
    const { servico, fontes } = montar({ fontes: [raiz] });

    await expect(servico.criarFonte({ caminho: fora })).rejects.toThrow(
      ForbiddenException,
    );
    expect(fontes.dados).toHaveLength(0);

    await rm(fora, { recursive: true, force: true });
  });

  it('recusa symlink que aponta para fora da raiz permitida', async () => {
    const fora = await realpath(await mkdtemp(join(tmpdir(), 'oraculo-alvo-')));
    const atalho = join(raiz, 'atalho');
    await symlink(fora, atalho);

    const { servico, fontes } = montar({ fontes: [raiz] });

    await expect(servico.criarFonte({ caminho: atalho })).rejects.toThrow(
      ForbiddenException,
    );
    expect(fontes.dados).toHaveLength(0);

    await rm(fora, { recursive: true, force: true });
  });

  it('recusa arquivo — fonte precisa ser pasta', async () => {
    const arquivo = join(raiz, 'solto.md');
    await writeFile(arquivo, '# nota');
    const { servico } = montar({ fontes: [raiz] });

    await expect(servico.criarFonte({ caminho: arquivo })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('recusa pasta cujo nome casa com a denylist — não indexaria nada', async () => {
    await mkdir(join(raiz, 'node_modules'));
    const { servico } = montar({ fontes: [raiz] });
    servico['config'].corpus.negados = ['node_modules'];

    await expect(
      servico.criarFonte({ caminho: join(raiz, 'node_modules') }),
    ).rejects.toThrow(BadRequestException);
  });

  it('recusa cadastrar a mesma pasta duas vezes', async () => {
    await mkdir(join(raiz, 'docs'));
    const { servico } = montar({ fontes: [raiz] });

    await servico.criarFonte({ caminho: join(raiz, 'docs') });

    await expect(
      servico.criarFonte({ caminho: join(raiz, 'docs') }),
    ).rejects.toThrow(ConflictException);
  });

  it('remove a fonte cadastrada e audita', async () => {
    await mkdir(join(raiz, 'docs'));
    const { servico, fontes, registrar } = montar({ fontes: [raiz] });

    const fonte = await servico.criarFonte({ caminho: join(raiz, 'docs') });
    await servico.removerFonte(fonte.id as string);

    expect(fontes.dados).toHaveLength(0);
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        ferramentas: [
          expect.objectContaining({ nome: 'ambiente.fonte.remover' }),
        ],
      }),
    );
  });

  it('recusa cadastrar fonte quando o ENV desliga o conhecimento', async () => {
    await mkdir(join(raiz, 'docs'));
    const { servico } = montar({ fontes: [raiz], conhecimento: false });

    await expect(
      servico.criarFonte({ caminho: join(raiz, 'docs') }),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('ConfiguracaoService — provedores de modelo', () => {
  const openai = {
    nome: 'ollama-local',
    tipo: 'openai-compat',
    baseUrl: 'http://localhost:11434/v1',
    modelo: 'llama3',
  };

  const anthropic = {
    nome: 'claude-api',
    tipo: 'anthropic',
    modelo: 'claude-haiku-4-5-20251001',
    chave: 'sk-ant-chave-muito-secreta-de-teste',
  };

  it('cadastra inativo e só ativa quando mandam ativar', async () => {
    const { servico } = montar();

    const criado = await servico.criarProvedor(openai, 'usuario-1');

    expect(criado.ativo).toBe(false);
    expect(await servico.provedorAtivo()).toBeNull();

    const ativado = await servico.ativarProvedor(criado.id, 'usuario-1');

    expect(ativado.ativo).toBe(true);
    expect(await servico.provedorAtivo()).toMatchObject({
      nome: 'ollama-local',
      tipo: 'openai-compat',
    });
  });

  it('ativar um desativa todos os outros', async () => {
    const { servico, modelos } = montar();

    const um = await servico.criarProvedor(openai);
    const outro = await servico.criarProvedor(anthropic);

    await servico.ativarProvedor(um.id);
    await servico.ativarProvedor(outro.id);

    const listados = await servico.provedores();

    expect(listados.filter((provedor) => provedor.ativo)).toHaveLength(1);
    expect(listados.find((provedor) => provedor.ativo)?.nome).toBe(
      'claude-api',
    );
    expect(modelos.manager.transaction).toHaveBeenCalledTimes(2);
    expect((await servico.provedorAtivo())?.nome).toBe('claude-api');
  });

  it('nunca devolve a chave em claro pelo CRUD', async () => {
    const { servico, modelos } = montar();

    const criado = await servico.criarProvedor(anthropic, 'usuario-1');

    expect(JSON.stringify(criado)).not.toContain(anthropic.chave);
    expect(criado).not.toHaveProperty('chaveCifrada');
    expect(criado.chave).toEqual({ definida: true, dica: '••••este' });

    const listados = await servico.provedores();

    expect(JSON.stringify(listados)).not.toContain(anthropic.chave);
    expect(modelos.dados[0].chaveCifrada).not.toContain(anthropic.chave);
  });

  it('guarda a chave cifrada e só a devolve por dentro, para o resolvedor', async () => {
    const { servico } = montar();
    const criado = await servico.criarProvedor(anthropic);

    await servico.ativarProvedor(criado.id);

    expect((await servico.provedorAtivo())?.chave).toBe(anthropic.chave);
  });

  it('não expõe o valor dos cabeçalhos extras, só o nome deles', async () => {
    const { servico } = montar();

    const criado = await servico.criarProvedor({
      ...openai,
      cabecalhosExtras: { 'x-api-key': 'valor-secreto-do-cabecalho' },
    });

    expect(JSON.stringify(criado)).not.toContain('valor-secreto-do-cabecalho');
    expect(criado.cabecalhosExtras).toEqual(['x-api-key']);
  });

  it('a auditoria de escrita nunca carrega a chave', async () => {
    const { servico, registrar } = montar();

    await servico.criarProvedor(anthropic, 'usuario-1');

    expect(JSON.stringify(registrar.mock.calls)).not.toContain(anthropic.chave);
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        ferramentas: [
          expect.objectContaining({ nome: 'ambiente.provedor.criar' }),
        ],
      }),
    );
  });

  it('audita a ativação dizendo de onde para onde foi', async () => {
    const { servico, registrar } = montar();
    const criado = await servico.criarProvedor(openai);

    registrar.mockClear();

    await servico.ativarProvedor(criado.id, 'usuario-1');

    const [registro] = registrar.mock.calls[0] as [
      { tom: string; resultado: string },
    ];

    expect(registro.tom).toBe('configuracao');
    expect(registro.resultado).toContain('do .env para "ollama-local"');
  });

  it('remove provedor existente e recusa id desconhecido', async () => {
    const { servico, modelos } = montar();
    const criado = await servico.criarProvedor(openai);

    await servico.removerProvedor(criado.id, 'usuario-1');

    expect(modelos.dados).toHaveLength(0);
    await expect(servico.removerProvedor('inexistente')).rejects.toThrow(
      /não existe/,
    );
  });

  it('recusa nome repetido', async () => {
    const { servico } = montar();

    await servico.criarProvedor(openai);

    await expect(servico.criarProvedor(openai)).rejects.toThrow(
      ConflictException,
    );
  });

  it('invalida o cache a cada escrita', async () => {
    const { servico, modelos } = montar();

    await servico.provedores();
    expect(modelos.find).toHaveBeenCalledTimes(1);

    const criado = await servico.criarProvedor(openai);
    expect(modelos.find.mock.calls.length).toBeGreaterThan(1);

    const antes = modelos.find.mock.calls.length;
    await servico.ativarProvedor(criado.id);
    expect(modelos.find.mock.calls.length).toBeGreaterThan(antes);
  });
});

describe('ConfiguracaoService — PROVEDORES_PERMITIDOS é o teto', () => {
  const foraDaLista = {
    nome: 'claude-api',
    tipo: 'anthropic',
    chave: 'sk-ant-chave-muito-secreta-de-teste',
  };

  it('recusa cadastrar tipo fora da lista, com motivo legível', async () => {
    const { servico, modelos } = montar({ provedores: ['cli'] });

    await expect(servico.criarProvedor(foraDaLista)).rejects.toThrow(
      /está fora de PROVEDORES_PERMITIDOS no \.env desta instalação/,
    );
    await expect(servico.criarProvedor(foraDaLista)).rejects.toThrow(
      ForbiddenException,
    );
    expect(modelos.save).not.toHaveBeenCalled();
  });

  it('recusa ativar linha de tipo que o ENV proíbe', async () => {
    const { servico } = montar(
      { provedores: ['cli'] },
      {
        modelos: [
          {
            id: 'plantado',
            nome: 'plantado-na-mao',
            tipo: TipoProvedorModelo.ANTHROPIC,
            ativo: false,
          },
        ],
      },
    );

    await expect(servico.ativarProvedor('plantado')).rejects.toThrow(
      /PROVEDORES_PERMITIDOS/,
    );
  });

  it('ignora linha ativa gravada por fora quando o ENV proíbe o tipo', async () => {
    const { servico } = montar(
      { provedores: ['cli'] },
      {
        modelos: [
          {
            id: 'plantado',
            nome: 'plantado-na-mao',
            tipo: TipoProvedorModelo.ANTHROPIC,
            ativo: true,
            chaveCifrada: null,
          },
        ],
      },
    );

    expect(await servico.provedorAtivo()).toBeNull();

    const listados = await servico.provedores();

    expect(listados[0].ativo).toBe(false);
    expect(listados[0].permitidoPeloEnv).toBe(false);
    expect(listados[0].motivoIndisponivel).toMatch(/PROVEDORES_PERMITIDOS/);
  });

  it('recusa tipo que não existe no catálogo', async () => {
    const { servico } = montar();

    await expect(
      servico.criarProvedor({ nome: 'x', tipo: 'ollama' }),
    ).rejects.toThrow(/não existe/);
  });
});

describe('ConfiguracaoService — provedor com endereço inseguro', () => {
  it('recusa baseUrl apontada para o serviço de metadados da instância', async () => {
    const { servico, modelos } = montar();

    await expect(
      servico.criarProvedor({
        nome: 'metadados',
        tipo: 'openai-compat',
        baseUrl: 'http://169.254.169.254/v1',
        modelo: 'qualquer',
      }),
    ).rejects.toThrow(/169\.254\.0\.0\/16/);
    expect(modelos.save).not.toHaveBeenCalled();
  });

  it('aceita baseUrl local, que é o caso do Ollama', async () => {
    const { servico } = montar();

    const criado = await servico.criarProvedor({
      nome: 'ollama',
      tipo: 'openai-compat',
      baseUrl: 'http://localhost:11434/v1',
      modelo: 'llama3',
    });

    expect(criado.baseUrl).toBe('http://localhost:11434/v1');
  });

  it('exige os campos mínimos de cada tipo', async () => {
    const { servico } = montar();

    await expect(
      servico.criarProvedor({ nome: 'sem-url', tipo: 'openai-compat' }),
    ).rejects.toThrow(/baseUrl e modelo/);
    await expect(
      servico.criarProvedor({ nome: 'sem-chave', tipo: 'anthropic' }),
    ).rejects.toThrow(/exige a chave/);
    await expect(
      servico.criarProvedor({ nome: 'sem-comando', tipo: 'cli' }),
    ).rejects.toThrow(/exige o comando/);
  });
});

describe('ConfiguracaoService — dialeto de CLI personalizado', () => {
  const descritorValido = JSON.stringify({
    id: 'meu-cli',
    argumentos: ['-p', '{prompt}'],
    formatoSaida: 'texto-puro',
  });

  it('aceita preset conhecido', async () => {
    const { servico } = montar({ conhecimento: true });

    const criado = await servico.criarProvedor({
      nome: 'com-preset',
      tipo: 'cli',
      comando: '/usr/local/bin/agy',
      dialeto: 'agy',
    });

    expect(criado.nome).toBe('com-preset');
  });

  it('aceita descritor JSON válido — sem isso o motor executaria algo que a api recusa gravar', async () => {
    const { servico } = montar({ conhecimento: true });

    const criado = await servico.criarProvedor({
      nome: 'cli-proprio',
      tipo: 'cli',
      comando: '/usr/local/bin/meu-cli',
      dialeto: descritorValido,
    });

    expect(criado.nome).toBe('cli-proprio');
  });

  it('recusa descritor JSON malformado com motivo legível', async () => {
    const { servico } = montar({ conhecimento: true });

    await expect(
      servico.criarProvedor({
        nome: 'quebrado',
        tipo: 'cli',
        comando: '/usr/local/bin/x',
        dialeto: '{ isso nao e json',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('recusa descritor sem marcador de prompt', async () => {
    const { servico } = montar({ conhecimento: true });

    await expect(
      servico.criarProvedor({
        nome: 'sem-prompt',
        tipo: 'cli',
        comando: '/usr/local/bin/x',
        dialeto: JSON.stringify({
          id: 'x',
          argumentos: ['--foo'],
          formatoSaida: 'texto-puro',
        }),
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
