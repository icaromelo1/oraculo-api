import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import type { RequisicaoAutenticada } from '../auth/requisicao-autenticada';
import { CifraService } from '../config/cifra.service';
import { OraculoConfig } from '../config/config.service';
import { ConfiguracaoService } from '../config/configuracao.service';
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
import type { EventoProvedor, LlmProvider } from '../providers/llm-provider';
import type { ConfigDoProvedor } from '../providers/provider.factory';
import { RedactionService } from '../security/redaction.service';
import { SecurityService } from '../security/security.service';
import { ProvedoresController } from './provedores.controller';
import { TesteDeProvedorService } from './teste-provedor.service';

const CHAVE_SECRETA = 'sk-chave-super-secreta-123456';
const TIMEOUT_DO_TESTE_MS = 20_000;

interface ComId {
  id?: string;
}

function criarRepositorio<T extends ComId>(inicial: Partial<T>[] = []) {
  const dados = inicial.map((item) => ({
    id: item.id ?? randomUUID(),
    ...item,
  })) as T[];

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
        dados.forEach((item, indice) => {
          if (!casa(item, criterio)) return;

          dados[indice] = { ...item, ...patch };
        });

        return Promise.resolve({ affected: 1 });
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

      const novo = {
        ...dado,
        id: dado.id ?? randomUUID(),
        criadoEm: new Date('2026-08-01T00:00:00.000Z'),
      } as T;
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

function configFalsa(
  permitidos: ('cli' | 'anthropic' | 'openai-compat')[] = [
    'openai-compat',
    'cli',
    'anthropic',
  ],
): OraculoConfig {
  return {
    capacidades: {
      conhecimento: true,
      codigo: true,
      estado: false,
      banco: false,
    },
    corpus: { fontes: [], negados: [], exibicao: [] },
    escopos: { repos: [], comandos: [], bancos: [] },
    provedoresPermitidos: permitidos,
    provedor: {
      tipo: 'cli',
      cliComando: 'agy',
      cliTimeoutMs: 120_000,
      cliDialeto: 'auto',
      cliModelo: 'gemini-3.6-flash-low',
      anthropicChave: undefined,
      anthropicModelo: 'claude-sonnet-4-5',
      openaiBaseUrl: undefined,
      openaiChave: undefined,
      openaiModelo: undefined,
    },
    segredoDeConfiguracao: 'segredo-de-teste-com-32-caracteres-ok',
  } as unknown as OraculoConfig;
}

function provedorFalso(eventos: EventoProvedor[]): LlmProvider {
  return {
    nome: 'falso',
    gerar: async function* () {
      for (const evento of eventos) {
        yield await Promise.resolve(evento);
      }
    },
  };
}

function provedorPendurado(): LlmProvider {
  return {
    nome: 'pendurado',
    gerar: async function* () {
      await new Promise((resolver) => setTimeout(resolver, 600_000));

      yield { tipo: 'texto', fragmento: 'tarde demais' };
    },
  };
}

interface Montagem {
  controlador: ProvedoresController;
  modelos: ReturnType<typeof criarRepositorio<ProvedorModelo>>;
  registrar: jest.Mock;
  fabrica: jest.Mock<LlmProvider, [ConfigDoProvedor]>;
  requisicao: RequisicaoAutenticada;
}

function montar(
  opcoes: {
    permitidos?: ('cli' | 'anthropic' | 'openai-compat')[];
    modelos?: Partial<ProvedorModelo>[];
    provedor?: LlmProvider;
  } = {},
): Montagem {
  const config = configFalsa(opcoes.permitidos);
  const cifra = new CifraService(config);
  const registrar = jest.fn().mockResolvedValue(null);
  const seguranca = { registrar } as unknown as SecurityService;

  const capacidades = criarRepositorio<CapacidadeInstalacao>();
  const fontes = criarRepositorio<FonteConhecimento>();
  const alvos = criarRepositorio<AlvoBanco>();
  const servicos = criarRepositorio<ServicoObservavel>();
  const modelos = criarRepositorio<ProvedorModelo>(opcoes.modelos ?? []);
  const modulos = criarRepositorio<Modulo>();
  const documentos = criarRepositorio<Documento>();
  const personas = criarRepositorio<Persona>();

  const configuracao = new ConfiguracaoService(
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

  const fabrica = jest.fn<LlmProvider, [ConfigDoProvedor]>(
    () => opcoes.provedor ?? provedorFalso([]),
  );

  const teste = new TesteDeProvedorService(
    config,
    cifra,
    seguranca,
    new RedactionService(),
    fabrica,
    modelos as unknown as Repository<ProvedorModelo>,
    configuracao,
  );

  return {
    controlador: new ProvedoresController(configuracao, teste, config),
    modelos,
    registrar,
    fabrica,
    requisicao: {
      usuario: { id: 'usuario-1' },
    } as unknown as RequisicaoAutenticada,
  };
}

describe('ProvedoresController — cadastro e listagem', () => {
  it('lista o cadastrado sem devolver a chave', async () => {
    const { controlador, requisicao } = montar();

    await controlador.criar(
      {
        nome: 'groq de casa',
        tipo: 'openai-compat',
        baseUrl: 'https://api.groq.com/openai/v1',
        modelo: 'llama-3.3-70b-versatile',
        chave: CHAVE_SECRETA,
      },
      requisicao,
    );

    const lista = await controlador.listar();

    expect(lista.provedores).toHaveLength(1);
    expect(lista.provedores[0].chave).toEqual({
      definida: true,
      dica: '••••3456',
    });
    expect(JSON.stringify(lista)).not.toContain(CHAVE_SECRETA);
    expect(lista.ativo).toBeNull();
    expect(lista.tiposPermitidos).toEqual([
      'openai-compat',
      'cli',
      'anthropic',
    ]);
  });

  it('devolve o catálogo de presets para a tela montar o formulário', () => {
    const { controlador } = montar();
    const { presets } = controlador.presets();

    expect(presets.map((preset) => preset.id)).toContain('groq');
    expect(presets.find((preset) => preset.id === 'ollama')?.exigeChave).toBe(
      false,
    );
  });

  it('cadastro com preset preenche baseUrl e modelo sugerido', async () => {
    const { controlador, requisicao } = montar();

    const criado = await controlador.criar(
      { nome: 'groq', preset: 'groq', chave: CHAVE_SECRETA },
      requisicao,
    );

    expect(criado.tipo).toBe(TipoProvedorModelo.OPENAI_COMPAT);
    expect(criado.baseUrl).toBe('https://api.groq.com/openai/v1');
    expect(criado.modelo).toBe('llama-3.3-70b-versatile');
    expect(criado.chave.definida).toBe(true);
    expect(JSON.stringify(criado)).not.toContain(CHAVE_SECRETA);
  });

  it('preset do openrouter traz os cabeçalhos exigidos', async () => {
    const { controlador, requisicao } = montar();

    const criado = await controlador.criar(
      { nome: 'openrouter', preset: 'openrouter', chave: CHAVE_SECRETA },
      requisicao,
    );

    expect(criado.cabecalhosExtras).toEqual(['HTTP-Referer', 'X-Title']);
  });

  it('recusa preset desconhecido com 400', () => {
    const { controlador, requisicao } = montar();

    expect(() =>
      controlador.criar({ nome: 'x', preset: 'inexistente' }, requisicao),
    ).toThrow(BadRequestException);
  });

  it('recusa corpo sem tipo e sem preset', () => {
    const { controlador, requisicao } = montar();

    expect(() => controlador.criar({ nome: 'x' }, requisicao)).toThrow(
      /informe "tipo" ou "preset"/,
    );
  });

  it('recusa tipo fora do teto do ENV', async () => {
    const { controlador, requisicao, modelos } = montar({
      permitidos: ['cli'],
    });

    await expect(
      controlador.criar(
        {
          nome: 'groq',
          tipo: 'openai-compat',
          baseUrl: 'https://api.groq.com/openai/v1',
          modelo: 'llama-3.3-70b-versatile',
        },
        requisicao,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(modelos.dados).toHaveLength(0);
  });

  it('ativar troca o provedor ativo', async () => {
    const { controlador, requisicao } = montar();

    const um = await controlador.criar(
      { nome: 'a-groq', preset: 'groq', chave: CHAVE_SECRETA },
      requisicao,
    );
    const outro = await controlador.criar(
      { nome: 'b-deepseek', preset: 'deepseek', chave: CHAVE_SECRETA },
      requisicao,
    );

    await controlador.ativar(um.id, requisicao);
    expect((await controlador.listar()).ativo?.id).toBe(um.id);

    await controlador.ativar(outro.id, requisicao);

    const lista = await controlador.listar();

    expect(lista.ativo?.id).toBe(outro.id);
    expect(lista.provedores.filter((provedor) => provedor.ativo)).toHaveLength(
      1,
    );
  });

  it('remover apaga o cadastro', async () => {
    const { controlador, requisicao, modelos } = montar();

    const criado = await controlador.criar(
      { nome: 'groq', preset: 'groq', chave: CHAVE_SECRETA },
      requisicao,
    );

    await controlador.remover(criado.id, requisicao);

    expect(modelos.dados).toHaveLength(0);
    expect((await controlador.listar()).provedores).toHaveLength(0);
  });
});

describe('ProvedoresController — teste de conexão', () => {
  it('sucesso devolve latência, modelo, amostra e tokens', async () => {
    const { controlador, requisicao, fabrica } = montar({
      provedor: provedorFalso([
        { tipo: 'texto', fragmento: 'ok' },
        { tipo: 'fim', tokensEntrada: 12, tokensSaida: 2, duracaoMs: 30 },
      ]),
    });

    const criado = await controlador.criar(
      { nome: 'groq', preset: 'groq', chave: CHAVE_SECRETA },
      requisicao,
    );

    const resultado = await controlador.testarCadastrado(criado.id, requisicao);

    expect(resultado.ok).toBe(true);
    expect(resultado.erro).toBeNull();
    expect(resultado.amostra).toBe('ok');
    expect(resultado.modelo).toBe('llama-3.3-70b-versatile');
    expect(resultado.tokensEntrada).toBe(12);
    expect(resultado.tokensSaida).toBe(2);
    expect(typeof resultado.latenciaMs).toBe('number');
    expect(resultado.latenciaMs).toBeGreaterThanOrEqual(0);

    const config = fabrica.mock.calls[0][0];

    expect(config.tipo).toBe('openai-compat');
    expect(config.openaiChave).toBe(CHAVE_SECRETA);
  });

  it('401 vira erro legível e não repete a chave', async () => {
    const { controlador, requisicao, registrar } = montar({
      provedor: provedorFalso([
        {
          tipo: 'erro',
          codigo: 'openai_http_401',
          mensagem: `Endpoint respondeu 401 Unauthorized: Invalid API key ${CHAVE_SECRETA}`,
          retomavel: false,
        },
      ]),
    });

    const criado = await controlador.criar(
      { nome: 'groq', preset: 'groq', chave: CHAVE_SECRETA },
      requisicao,
    );

    const resultado = await controlador.testarCadastrado(criado.id, requisicao);

    expect(resultado.ok).toBe(false);
    expect(resultado.erro).toContain(
      'a chave foi recusada pelo provedor (401)',
    );
    expect(resultado.erro).not.toContain(CHAVE_SECRETA);
    expect(resultado.amostra).toBeNull();
    expect(JSON.stringify(registrar.mock.calls)).not.toContain(CHAVE_SECRETA);
  });

  it('binário de CLI ausente vira erro legível', async () => {
    const { controlador, requisicao } = montar({
      provedor: provedorFalso([
        {
          tipo: 'erro',
          codigo: 'cli_spawn_falhou',
          mensagem: 'spawn agy ENOENT',
          retomavel: false,
        },
      ]),
    });

    const criado = await controlador.criar(
      { nome: 'agy local', tipo: 'cli', comando: 'agy', modelo: 'flash' },
      requisicao,
    );

    const resultado = await controlador.testarCadastrado(criado.id, requisicao);

    expect(resultado.ok).toBe(false);
    expect(resultado.erro).toContain('o binário do CLI não foi encontrado');
    expect(resultado.erro).toContain('ENOENT');
  });

  it('provedor que não responde é cortado pelo timeout do teste', async () => {
    jest.useFakeTimers();

    try {
      const { controlador, requisicao } = montar({
        provedor: provedorPendurado(),
      });

      const criado = await controlador.criar(
        { nome: 'groq', preset: 'groq', chave: CHAVE_SECRETA },
        requisicao,
      );

      const promessa = controlador.testarCadastrado(criado.id, requisicao);

      await jest.advanceTimersByTimeAsync(TIMEOUT_DO_TESTE_MS + 10);

      const resultado = await promessa;

      expect(resultado.ok).toBe(false);
      expect(resultado.erro).toContain('não respondeu em 20s');
    } finally {
      jest.useRealTimers();
    }
  });

  it('baseUrl link-local é recusada no teste, sem chegar ao provedor', async () => {
    const { controlador, requisicao, fabrica } = montar({
      modelos: [
        {
          id: 'provedor-metadados',
          nome: 'metadados',
          tipo: TipoProvedorModelo.OPENAI_COMPAT,
          baseUrl: 'http://169.254.169.254/latest/v1',
          modelo: 'qualquer',
          chaveCifrada: null,
          cabecalhosExtras: null,
          parametros: null,
          comando: null,
          dialeto: null,
          ativo: false,
        },
      ],
    });

    const resultado = await controlador.testarCadastrado(
      'provedor-metadados',
      requisicao,
    );

    expect(resultado.ok).toBe(false);
    expect(resultado.erro).toContain('169.254.0.0/16');
    expect(fabrica).not.toHaveBeenCalled();
  });

  it('teste avulso valida antes de salvar e não deixa nada no banco', async () => {
    const { controlador, requisicao, modelos } = montar({
      provedor: provedorFalso([
        { tipo: 'texto', fragmento: 'ok' },
        { tipo: 'fim', tokensEntrada: 9, tokensSaida: 1, duracaoMs: 12 },
      ]),
    });

    const resultado = await controlador.testarAvulso(
      { preset: 'groq', chave: CHAVE_SECRETA },
      requisicao,
    );

    expect(resultado.ok).toBe(true);
    expect(resultado.amostra).toBe('ok');
    expect(resultado.modelo).toBe('llama-3.3-70b-versatile');
    expect(modelos.dados).toHaveLength(0);
  });

  it('teste avulso com endereço link-local é recusado', async () => {
    const { controlador, requisicao, fabrica } = montar();

    const resultado = await controlador.testarAvulso(
      {
        tipo: 'openai-compat',
        baseUrl: 'http://169.254.169.254/v1',
        modelo: 'qualquer',
      },
      requisicao,
    );

    expect(resultado.ok).toBe(false);
    expect(resultado.erro).toContain('169.254.0.0/16');
    expect(fabrica).not.toHaveBeenCalled();
  });

  it('teste avulso de tipo fora do teto do ENV é recusado', async () => {
    const { controlador, requisicao } = montar({ permitidos: ['cli'] });

    await expect(
      controlador.testarAvulso(
        {
          tipo: 'openai-compat',
          baseUrl: 'https://api.groq.com/openai/v1',
          modelo: 'llama-3.3-70b-versatile',
        },
        requisicao,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('teste de provedor inexistente devolve 404', async () => {
    const { controlador, requisicao } = montar();

    await expect(
      controlador.testarCadastrado('nao-existe', requisicao),
    ).rejects.toThrow(/não existe/);
  });

  it('audita o teste sem a chave e com o veredicto', async () => {
    const { controlador, requisicao, registrar } = montar({
      provedor: provedorFalso([
        { tipo: 'texto', fragmento: 'ok' },
        { tipo: 'fim', tokensEntrada: 4, tokensSaida: 1, duracaoMs: 5 },
      ]),
    });

    const criado = await controlador.criar(
      { nome: 'groq', preset: 'groq', chave: CHAVE_SECRETA },
      requisicao,
    );

    registrar.mockClear();

    await controlador.testarCadastrado(criado.id, requisicao);

    expect(registrar).toHaveBeenCalledTimes(1);

    const chamadas = registrar.mock.calls as [
      {
        usuarioId: string;
        resultado: string;
        ferramentas: { nome: string; argumento: Record<string, unknown> }[];
      },
    ][];
    const registro = chamadas[0][0];

    expect(registro.usuarioId).toBe('usuario-1');
    expect(registro.ferramentas[0].nome).toBe('ambiente.provedor.testar');
    expect(registro.ferramentas[0].argumento.chave).toBeUndefined();
    expect(registro.resultado).toContain('respondeu em');
  });
});
