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
  NotFoundException,
} from '@nestjs/common';
import { FindOperator, Repository } from 'typeorm';
import {
  AlvoBanco,
  CapacidadeInstalacao,
  Documento,
  FonteConhecimento,
  Modulo,
  Persona,
  ProvedorModelo,
  ServicoObservavel,
  TipoProvedorModelo,
} from '../database/entities';
import { SecurityService } from '../security/security.service';
import { CifraService } from './cifra.service';
import { OraculoConfig } from './config.service';
import {
  ConfiguracaoService,
  TETO_DO_MAPA_DE_MODULOS,
} from './configuracao.service';

interface ComId {
  id?: string;
}

const ROTAS = new Map<unknown, { dados: ComId[] }>();

function casaCriterio(item: ComId, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([chave, valor]) => {
    const atual = (item as Record<string, unknown>)[chave];

    if (valor instanceof FindOperator) {
      return (valor.value as unknown[]).includes(atual);
    }

    return atual === valor;
  });
}

function criarRepositorio<T extends ComId>(
  inicial: T[] = [],
  entidade?: unknown,
) {
  const dados: T[] = inicial.map((item) => ({
    id: item.id ?? randomUUID(),
    ...item,
  }));

  const casa = (item: T, where: Record<string, unknown>) =>
    casaCriterio(item, where);

  const alvo = (entidadeAlvo: unknown): ComId[] =>
    ROTAS.get(entidadeAlvo)?.dados ?? dados;

  const aplicar = (
    linhas: ComId[],
    criterio: Record<string, unknown>,
    patch: Record<string, unknown>,
  ) => {
    let afetados = 0;

    linhas.forEach((item, indice) => {
      if (!casaCriterio(item, criterio)) return;

      linhas[indice] = { ...item, ...patch };
      afetados += 1;
    });

    return afetados;
  };

  const gerenciador = {
    update: jest.fn(
      (
        entidadeAlvo: unknown,
        criterio: Record<string, unknown>,
        patch: Record<string, unknown>,
      ) =>
        Promise.resolve({
          affected: aplicar(alvo(entidadeAlvo), criterio, patch),
        }),
    ),
    delete: jest.fn(
      (entidadeAlvo: unknown, criterio: Record<string, unknown>) => {
        const linhas = alvo(entidadeAlvo);
        const indice = linhas.findIndex((item) => casaCriterio(item, criterio));

        if (indice >= 0) {
          linhas.splice(indice, 1);
        }

        return Promise.resolve({ affected: indice >= 0 ? 1 : 0 });
      },
    ),
  };

  const repositorio = {
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
    update: jest.fn(
      (criterio: Record<string, unknown>, patch: Record<string, unknown>) =>
        Promise.resolve({ affected: aplicar(dados, criterio, patch) }),
    ),
    delete: jest.fn((criterio: Record<string, unknown>) => {
      const indice = dados.findIndex((item) => casa(item, criterio));

      if (indice >= 0) {
        dados.splice(indice, 1);
      }

      return Promise.resolve({ affected: indice >= 0 ? 1 : 0 });
    }),
    dados,
  };

  if (entidade) {
    ROTAS.set(entidade, repositorio);
  }

  return repositorio;
}

function criarRepositorioDeDocumentos(inicial: Partial<Documento>[] = []) {
  const repositorio = criarRepositorio(inicial as Documento[], Documento);

  return Object.assign(repositorio, {
    createQueryBuilder: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(() => {
        const contagem = new Map<string | null, number>();

        for (const documento of repositorio.dados) {
          const chave = documento.moduloId ?? null;

          contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
        }

        return Promise.resolve(
          [...contagem.entries()].map(([moduloId, total]) => ({
            moduloId,
            total,
          })),
        );
      }),
    })),
  });
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
  modulos: RepositorioFalso<Modulo>;
  documentos: ReturnType<typeof criarRepositorioDeDocumentos>;
  personas: RepositorioFalso<Persona>;
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
    modulos?: Partial<Modulo>[];
    documentos?: Partial<Documento>[];
    personas?: Partial<Persona>[];
  } = {},
): Montagem {
  ROTAS.clear();

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
  const modulos = criarRepositorio(
    (sementes.modulos ?? []) as Modulo[],
    Modulo,
  );
  const documentos = criarRepositorioDeDocumentos(sementes.documentos ?? []);
  const personas = criarRepositorio((sementes.personas ?? []) as Persona[]);

  const servico = new ConfiguracaoService(
    config,
    cifra,
    seguranca,
    capacidades as unknown as Repository<CapacidadeInstalacao>,
    fontes as unknown as Repository<FonteConhecimento>,
    alvos as unknown as Repository<AlvoBanco>,
    servicos as unknown as Repository<ServicoObservavel>,
    modelos as unknown as Repository<ProvedorModelo>,
    modulos as unknown as Repository<Modulo>,
    documentos as unknown as Repository<Documento>,
    personas as unknown as Repository<Persona>,
  );

  return {
    servico,
    capacidades,
    fontes,
    alvos,
    servicos,
    modelos,
    modulos,
    documentos,
    personas,
    registrar,
  };
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

describe('ConfiguracaoService — módulos de conhecimento', () => {
  it('recusa criar módulo sem descrição, e a mensagem explica por quê', async () => {
    const { servico, modulos } = montar();

    await expect(
      servico.criarModulo({ nome: 'memoria', descricao: '   ' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      servico.criarModulo({ nome: 'memoria', descricao: '' }),
    ).rejects.toThrow(/precisa de uma descrição/);
    expect(modulos.save).not.toHaveBeenCalled();
  });

  it('recusa esvaziar a descrição de um módulo já criado', async () => {
    const { servico } = montar();
    const criado = await servico.criarModulo({
      nome: 'memoria',
      descricao: 'decisoes e jeito de trabalhar do dono',
    });

    await expect(
      servico.atualizarModulo(criado.id, { descricao: '  ' }),
    ).rejects.toThrow(/precisa de uma descrição/);
  });

  it('recusa módulo com nome repetido', async () => {
    const { servico } = montar();

    await servico.criarModulo({ nome: 'memoria', descricao: 'coisas do dono' });

    await expect(
      servico.criarModulo({ nome: 'memoria', descricao: 'outra coisa' }),
    ).rejects.toThrow(ConflictException);
  });

  it('recusa renomear um módulo para o nome de outro', async () => {
    const { servico } = montar();

    await servico.criarModulo({ nome: 'memoria', descricao: 'coisas do dono' });
    const outro = await servico.criarModulo({
      nome: 'infra',
      descricao: 'servidores e deploy',
    });

    await expect(
      servico.atualizarModulo(outro.id, { nome: 'memoria' }),
    ).rejects.toThrow(ConflictException);
  });

  it('deixa renomear mantendo o próprio nome', async () => {
    const { servico } = montar();
    const criado = await servico.criarModulo({
      nome: 'infra',
      descricao: 'servidores e deploy',
    });

    const atualizado = await servico.atualizarModulo(criado.id, {
      nome: 'infra',
      descricao: 'servidores, deploy e rede',
    });

    expect(atualizado.descricao).toBe('servidores, deploy e rede');
  });

  it('remover módulo desassocia os documentos sem apagar nenhum', async () => {
    const { servico, documentos, modulos } = montar(
      {},
      {
        documentos: [
          { id: 'doc-1', titulo: 'um', moduloId: null },
          { id: 'doc-2', titulo: 'dois', moduloId: null },
        ],
      },
    );

    const modulo = await servico.criarModulo({
      nome: 'infra',
      descricao: 'servidores e deploy',
    });

    await servico.moverDocumentos(['doc-1', 'doc-2'], modulo.id);
    await servico.removerModulo(modulo.id, 'usuario-1');

    expect(modulos.dados).toHaveLength(0);
    expect(documentos.dados).toHaveLength(2);
    expect(documentos.dados.map((item) => item.moduloId)).toEqual([null, null]);
  });

  it('move documentos de um módulo para outro e depois para nenhum', async () => {
    const { servico, documentos } = montar(
      {},
      {
        documentos: [
          { id: 'doc-1', titulo: 'um', moduloId: null },
          { id: 'doc-2', titulo: 'dois', moduloId: null },
        ],
      },
    );

    const origem = await servico.criarModulo({
      nome: 'infra',
      descricao: 'servidores e deploy',
    });
    const destino = await servico.criarModulo({
      nome: 'memoria',
      descricao: 'coisas do dono',
    });

    await servico.moverDocumentos(['doc-1', 'doc-2'], origem.id);
    const mudanca = await servico.moverDocumentos(['doc-1'], destino.id);

    expect(mudanca).toEqual({ movidos: 1, moduloId: destino.id });
    expect(documentos.dados[0].moduloId).toBe(destino.id);
    expect(documentos.dados[1].moduloId).toBe(origem.id);

    await servico.moverDocumentos(['doc-1'], null);

    expect(documentos.dados[0].moduloId).toBeNull();
  });

  it('recusa mover para módulo inexistente e recusa lista vazia', async () => {
    const { servico } = montar(
      {},
      { documentos: [{ id: 'doc-1', titulo: 'um', moduloId: null }] },
    );

    await expect(
      servico.moverDocumentos(['doc-1'], 'modulo-que-nao-existe'),
    ).rejects.toThrow(NotFoundException);
    await expect(servico.moverDocumentos([], null)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('define e limpa o documento-capa do módulo', async () => {
    const { servico } = montar(
      {},
      {
        documentos: [{ id: 'doc-1', titulo: 'capa da infra', moduloId: null }],
      },
    );

    const modulo = await servico.criarModulo({
      nome: 'infra',
      descricao: 'servidores e deploy',
    });

    const comCapa = await servico.definirEspecialista(modulo.id, 'doc-1');

    expect(comCapa.especialistaDocumentoId).toBe('doc-1');

    const semCapa = await servico.definirEspecialista(modulo.id, null);

    expect(semCapa.especialistaDocumentoId).toBeNull();
  });

  it('recusa documento-capa que não está indexado', async () => {
    const { servico } = montar();
    const modulo = await servico.criarModulo({
      nome: 'infra',
      descricao: 'servidores e deploy',
    });

    await expect(
      servico.definirEspecialista(modulo.id, 'doc-fantasma'),
    ).rejects.toThrow(NotFoundException);
  });

  it('descreve documento e aceita apagar a descrição', async () => {
    const { servico, documentos } = montar(
      {},
      { documentos: [{ id: 'doc-1', titulo: 'um', descricao: null }] },
    );

    await servico.descreverDocumento('doc-1', '  como o deploy funciona  ');

    expect(documentos.dados[0].descricao).toBe('como o deploy funciona');

    const limpa = await servico.descreverDocumento('doc-1', '   ');

    expect(limpa.descricao).toBeNull();
    expect(documentos.dados[0].descricao).toBeNull();
  });

  it('lista os módulos com a contagem de documentos', async () => {
    const { servico } = montar(
      {},
      {
        documentos: [
          { id: 'doc-1', titulo: 'um', moduloId: null },
          { id: 'doc-2', titulo: 'dois', moduloId: null },
        ],
      },
    );

    const modulo = await servico.criarModulo({
      nome: 'infra',
      descricao: 'servidores e deploy',
    });
    await servico.criarModulo({ nome: 'vazio', descricao: 'nada aqui' });
    await servico.moverDocumentos(['doc-1'], modulo.id);

    const listados = await servico.modulos();

    expect(listados.map((item) => [item.nome, item.documentos])).toEqual([
      ['infra', 1],
      ['vazio', 0],
    ]);
  });

  it('invalida o cache a cada escrita de módulo', async () => {
    const { servico, modulos } = montar();

    await servico.modulos();
    expect(modulos.find).toHaveBeenCalledTimes(1);

    const criado = await servico.criarModulo({
      nome: 'infra',
      descricao: 'servidores e deploy',
    });
    expect(modulos.find.mock.calls.length).toBeGreaterThan(1);

    const antes = modulos.find.mock.calls.length;
    await servico.atualizarModulo(criado.id, { descricao: 'outra coisa' });
    expect(modulos.find.mock.calls.length).toBeGreaterThan(antes);

    const antesDaRemocao = modulos.find.mock.calls.length;
    await servico.removerModulo(criado.id);
    expect(modulos.find.mock.calls.length).toBeGreaterThan(antesDaRemocao);
  });
});

describe('ConfiguracaoService — auditoria dos módulos', () => {
  it('audita criar, atualizar, definir capa, mover, descrever e remover', async () => {
    const { servico, registrar } = montar(
      {},
      { documentos: [{ id: 'doc-1', titulo: 'um', moduloId: null }] },
    );

    const modulo = await servico.criarModulo(
      { nome: 'infra', descricao: 'servidores e deploy' },
      'usuario-1',
    );
    await servico.atualizarModulo(
      modulo.id,
      { descricao: 'servidores, deploy e rede' },
      'usuario-1',
    );
    await servico.moverDocumentos(['doc-1'], modulo.id, 'usuario-1');
    await servico.definirEspecialista(modulo.id, 'doc-1', 'usuario-1');
    await servico.descreverDocumento('doc-1', 'a capa', 'usuario-1');
    await servico.removerModulo(modulo.id, 'usuario-1');

    const acoes = (registrar.mock.calls as unknown[][]).map((chamada) => {
      const registro = chamada[0] as {
        ferramentas: { nome: string }[];
        usuarioId: string;
        tom: string;
      };

      return [registro.ferramentas[0].nome, registro.usuarioId, registro.tom];
    });

    expect(acoes).toEqual([
      ['ambiente.modulo.criar', 'usuario-1', 'configuracao'],
      ['ambiente.modulo.atualizar', 'usuario-1', 'configuracao'],
      ['ambiente.modulo.mover', 'usuario-1', 'configuracao'],
      ['ambiente.modulo.especialista', 'usuario-1', 'configuracao'],
      ['ambiente.documento.descrever', 'usuario-1', 'configuracao'],
      ['ambiente.modulo.remover', 'usuario-1', 'configuracao'],
    ]);
    expect(registroDe(registrar, 5).resultado).toContain(
      'deixando 1 documento sem módulo',
    );
    expect(registroDe(registrar, 2).resultado).toBe(
      'módulo de 1 documento passou para "infra"',
    );
  });
});

describe('ConfiguracaoService — mapa compacto de módulos', () => {
  it('devolve uma linha por módulo, com descrição e contagem', async () => {
    const { servico } = montar(
      {},
      {
        documentos: [
          { id: 'doc-1', titulo: 'um', moduloId: null },
          { id: 'doc-2', titulo: 'dois', moduloId: null },
        ],
      },
    );

    const modulo = await servico.criarModulo({
      nome: 'memoria e preferencias',
      descricao: 'decisoes e jeito de trabalhar do dono',
    });

    await servico.moverDocumentos(['doc-1', 'doc-2'], modulo.id);

    expect(await servico.mapaDeModulos()).toBe(
      '- memoria e preferencias: decisoes e jeito de trabalhar do dono (2 documentos)',
    );
  });

  it('omite módulo sem documento e fecha com os documentos sem módulo', async () => {
    const { servico } = montar(
      {},
      {
        documentos: [
          { id: 'doc-1', titulo: 'um', moduloId: null },
          { id: 'doc-2', titulo: 'dois', moduloId: null },
          { id: 'doc-3', titulo: 'tres', moduloId: null },
        ],
      },
    );

    const modulo = await servico.criarModulo({
      nome: 'infra',
      descricao: 'servidores e deploy',
    });
    await servico.criarModulo({ nome: 'vazio', descricao: 'nada aqui ainda' });
    await servico.moverDocumentos(['doc-1'], modulo.id);

    const mapa = await servico.mapaDeModulos();

    expect(mapa).toBe(
      [
        '- infra: servidores e deploy (1 documento)',
        '- sem modulo: 2 documentos',
      ].join('\n'),
    );
    expect(mapa).not.toContain('vazio');
  });

  it('não passa do teto de caracteres, mesmo com muito módulo', async () => {
    const documentos = Array.from({ length: 40 }, (_, indice) => ({
      id: `doc-${indice}`,
      titulo: `documento ${indice}`,
      moduloId: null,
    }));
    const { servico } = montar({}, { documentos });

    for (let indice = 0; indice < 20; indice += 1) {
      const modulo = await servico.criarModulo({
        nome: `modulo numero ${indice}`,
        descricao:
          'uma descrição bem comprida que existe justamente para inflar o prompt de sistema e provar que o teto de caracteres é respeitado de verdade',
      });

      await servico.moverDocumentos([`doc-${indice * 2}`], modulo.id);
    }

    const mapa = await servico.mapaDeModulos();

    expect(mapa.length).toBeLessThanOrEqual(TETO_DO_MAPA_DE_MODULOS);
    expect(mapa.split('\n').length).toBeLessThan(21);
    expect(mapa).toContain('- sem modulo: 20 documentos');
  });

  it('é vazio quando não há módulo nem documento', async () => {
    const { servico } = montar();

    expect(await servico.mapaDeModulos()).toBe('');
  });
});

describe('ConfiguracaoService — persona da instalação', () => {
  it('sem linha no banco, não há persona e vale a do código', async () => {
    const { servico } = montar();

    expect(await servico.persona()).toBeNull();
  });

  it('devolve a persona gravada, já aparada', async () => {
    const { servico } = montar(
      {},
      { personas: [{ texto: '  Voce fala como um plantonista.  ' }] },
    );

    expect(await servico.persona()).toBe('Voce fala como um plantonista.');
  });

  it('grava a persona, invalida o cache e audita a troca', async () => {
    const { servico, personas, registrar } = montar();

    const gravada = await servico.definirPersona('Persona nova', 'u1');

    expect(gravada).toBe('Persona nova');
    expect(await servico.persona()).toBe('Persona nova');
    expect(personas.dados).toHaveLength(1);

    const registro = registroDe(registrar, 0);

    expect(registro.tom).toBe('configuracao');
    expect(registro.resultado).toBe(
      'persona da instalação passou de a do código para 12 caractere(s)',
    );
    expect(registro.ferramentas).toEqual([
      {
        nome: 'ambiente.persona.definir',
        argumento: { caracteres: 12 },
        status: 'aplicada',
      },
    ]);
  });

  it('reescreve a mesma linha em vez de acumular personas', async () => {
    const { servico, personas } = montar(
      {},
      { personas: [{ id: 'persona-1', texto: 'primeira' }] },
    );

    await servico.definirPersona('segunda');

    expect(personas.dados).toHaveLength(1);
    expect(personas.dados[0]).toMatchObject({
      id: 'persona-1',
      texto: 'segunda',
    });
  });

  it('persona vazia volta para a do código', async () => {
    const { servico } = montar({}, { personas: [{ texto: 'persona antiga' }] });

    expect(await servico.definirPersona('   ')).toBeNull();
    expect(await servico.persona()).toBeNull();
  });

  it('a persona não carrega nenhum bloco fixo do prompt', async () => {
    const { servico, personas } = montar();

    await servico.definirPersona('qualquer coisa');

    expect(Object.keys(personas.dados[0]).sort()).toEqual([
      'atualizadaPor',
      'id',
      'texto',
    ]);
  });
});

describe('ConfiguracaoService — módulo por nome', () => {
  it('acha o módulo pelo nome que o modelo vê no mapa', async () => {
    const { servico } = montar(
      {},
      { modulos: [{ id: 'm1', nome: 'memoria e preferencias' }] },
    );

    expect(await servico.identificarModulo('memoria e preferencias')).toEqual({
      id: 'm1',
      nome: 'memoria e preferencias',
    });
  });

  it('ignora caixa e espaço sobrando', async () => {
    const { servico } = montar(
      {},
      { modulos: [{ id: 'm1', nome: 'VM Oracle' }] },
    );

    expect(await servico.identificarModulo('  vm   oracle ')).toMatchObject({
      id: 'm1',
    });
  });

  it('devolve nulo para nome que não existe e para nome vazio', async () => {
    const { servico } = montar(
      {},
      { modulos: [{ id: 'm1', nome: 'vm oracle' }] },
    );

    expect(await servico.identificarModulo('financeiro')).toBeNull();
    expect(await servico.identificarModulo('   ')).toBeNull();
  });
});
