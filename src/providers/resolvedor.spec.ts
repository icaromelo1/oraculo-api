import { OraculoConfig } from '../config/config.service';
import type {
  ConfiguracaoService,
  ProvedorAtivo,
} from '../config/configuracao.service';
import { TipoProvedorModelo } from '../database/entities';
import { AnthropicProvider } from './anthropic.provider';
import { CliProvider } from './cli.provider';
import { OpenAiCompatProvider } from './openai-compat.provider';
import { ResolvedorDeProvedor } from './resolvedor';

function configFalsa(): OraculoConfig {
  return {
    provedor: {
      tipo: 'cli',
      cliComando: 'agy',
      cliTimeoutMs: 120_000,
      cliDialeto: 'auto',
      cliModelo: 'gemini-do-env',
      anthropicChave: undefined,
      anthropicModelo: 'claude-haiku-4-5-20251001',
      openaiBaseUrl: undefined,
      openaiChave: undefined,
      openaiModelo: undefined,
    },
    provedoresPermitidos: ['cli', 'anthropic', 'openai-compat'],
  } as unknown as OraculoConfig;
}

function provedorAtivo(parcial: Partial<ProvedorAtivo> = {}): ProvedorAtivo {
  return {
    id: 'id-1',
    nome: 'ollama-local',
    tipo: TipoProvedorModelo.OPENAI_COMPAT,
    baseUrl: 'http://localhost:11434/v1',
    modelo: 'llama3',
    chave: null,
    cabecalhosExtras: null,
    parametros: null,
    comando: null,
    dialeto: null,
    ...parcial,
  };
}

function configuracaoFalsa(inicial: ProvedorAtivo | null) {
  let atual = inicial;

  const servico = {
    provedorAtivo: jest.fn(() => Promise.resolve(atual)),
    provedorAtivoSincrono: jest.fn(() => atual),
  };

  return {
    servico: servico as unknown as ConfiguracaoService,
    trocar: (novo: ProvedorAtivo | null) => {
      atual = novo;
    },
    espiao: servico,
  };
}

describe('ResolvedorDeProvedor — cai no .env quando não há ativo', () => {
  it('usa o provedor do .env quando o banco não tem nenhum cadastrado', async () => {
    const { servico } = configuracaoFalsa(null);
    const resolvedor = new ResolvedorDeProvedor(configFalsa(), servico);

    expect(await resolvedor.resolver()).toBeInstanceOf(CliProvider);
    expect(resolvedor.nome).toBe('cli');
  });

  it('usa o provedor do .env quando o ConfiguracaoService nem existe', async () => {
    const resolvedor = new ResolvedorDeProvedor(configFalsa());

    expect(await resolvedor.resolver()).toBeInstanceOf(CliProvider);
    expect(resolvedor.nome).toBe('cli');
  });

  it('cai no .env quando a leitura do provedor ativo falha', async () => {
    const servico = {
      provedorAtivo: jest.fn(() => Promise.reject(new Error('banco fora'))),
      provedorAtivoSincrono: jest.fn(() => null),
    } as unknown as ConfiguracaoService;
    const resolvedor = new ResolvedorDeProvedor(configFalsa(), servico);

    expect(await resolvedor.resolver()).toBeInstanceOf(CliProvider);
  });
});

describe('ResolvedorDeProvedor — troca sem recriar o app', () => {
  it('troca de implementação quando o provedor ativo muda', async () => {
    const { servico, trocar } = configuracaoFalsa(null);
    const resolvedor = new ResolvedorDeProvedor(configFalsa(), servico);

    expect(await resolvedor.resolver()).toBeInstanceOf(CliProvider);

    trocar(provedorAtivo());

    expect(await resolvedor.resolver()).toBeInstanceOf(OpenAiCompatProvider);

    trocar(
      provedorAtivo({
        nome: 'claude-api',
        tipo: TipoProvedorModelo.ANTHROPIC,
        baseUrl: null,
        modelo: 'claude-haiku-4-5-20251001',
        chave: 'chave-secreta-de-teste',
      }),
    );

    expect(await resolvedor.resolver()).toBeInstanceOf(AnthropicProvider);

    trocar(null);

    expect(await resolvedor.resolver()).toBeInstanceOf(CliProvider);
  });

  it('o nome reflete o provedor ativo, para a auditoria do motor', () => {
    const { servico, trocar } = configuracaoFalsa(null);
    const resolvedor = new ResolvedorDeProvedor(configFalsa(), servico);

    expect(resolvedor.nome).toBe('cli');

    trocar(provedorAtivo());

    expect(resolvedor.nome).toBe('openai-compat:ollama-local');
  });

  it('monta o provedor cli com comando, dialeto e modelo do banco', async () => {
    const { servico } = configuracaoFalsa(
      provedorAtivo({
        nome: 'claude-cli',
        tipo: TipoProvedorModelo.CLI,
        baseUrl: null,
        modelo: 'claude-haiku-4-5-20251001',
        comando: '/usr/local/bin/claude',
        dialeto: 'claude',
      }),
    );
    const resolvedor = new ResolvedorDeProvedor(configFalsa(), servico);
    const provedor = await resolvedor.resolver();

    expect(provedor).toBeInstanceOf(CliProvider);
    expect(
      (provedor as unknown as { config: Record<string, unknown> }).config,
    ).toMatchObject({
      cliComando: '/usr/local/bin/claude',
      cliDialeto: 'claude',
      cliModelo: 'claude-haiku-4-5-20251001',
    });
  });
});

describe('ResolvedorDeProvedor — extras do openai-compat', () => {
  it('leva cabeçalhos e parâmetros do banco para a config do provedor', async () => {
    const { servico } = configuracaoFalsa(
      provedorAtivo({
        cabecalhosExtras: { 'X-Title': 'Oráculo' },
        parametros: { temperature: 0.2 },
      }),
    );
    const resolvedor = new ResolvedorDeProvedor(configFalsa(), servico);
    const provedor = await resolvedor.resolver();

    expect(provedor).toBeInstanceOf(OpenAiCompatProvider);
    expect(
      (provedor as unknown as { config: Record<string, unknown> }).config,
    ).toMatchObject({
      openaiCabecalhos: { 'X-Title': 'Oráculo' },
      openaiParametros: { temperature: 0.2 },
    });
  });

  it('descarta a instância quando um cabeçalho extra muda', async () => {
    const { servico, trocar } = configuracaoFalsa(
      provedorAtivo({ cabecalhosExtras: { 'X-Title': 'Oráculo' } }),
    );
    const resolvedor = new ResolvedorDeProvedor(configFalsa(), servico);

    const primeira = await resolvedor.resolver();

    trocar(provedorAtivo({ cabecalhosExtras: { 'X-Title': 'Outro' } }));

    expect(await resolvedor.resolver()).not.toBe(primeira);
  });

  it('descarta a instância quando um parâmetro extra muda', async () => {
    const { servico, trocar } = configuracaoFalsa(
      provedorAtivo({ parametros: { temperature: 0.2 } }),
    );
    const resolvedor = new ResolvedorDeProvedor(configFalsa(), servico);

    const primeira = await resolvedor.resolver();

    trocar(provedorAtivo({ parametros: { temperature: 0.9 } }));

    expect(await resolvedor.resolver()).not.toBe(primeira);
  });
});

describe('ResolvedorDeProvedor — cache por configuração', () => {
  it('reusa a instância enquanto a configuração não muda', async () => {
    const { servico } = configuracaoFalsa(provedorAtivo());
    const resolvedor = new ResolvedorDeProvedor(configFalsa(), servico);

    const primeira = await resolvedor.resolver();
    const segunda = await resolvedor.resolver();

    expect(segunda).toBe(primeira);
  });

  it('reusa a instância quando só muda o que não afeta a construção', async () => {
    const { servico, trocar } = configuracaoFalsa(provedorAtivo());
    const resolvedor = new ResolvedorDeProvedor(configFalsa(), servico);

    const primeira = await resolvedor.resolver();

    trocar(provedorAtivo({ id: 'outro-id', nome: 'outro-rotulo' }));

    expect(await resolvedor.resolver()).toBe(primeira);
  });

  it('descarta a instância quando o modelo muda', async () => {
    const { servico, trocar } = configuracaoFalsa(provedorAtivo());
    const resolvedor = new ResolvedorDeProvedor(configFalsa(), servico);

    const primeira = await resolvedor.resolver();

    trocar(provedorAtivo({ modelo: 'llama3.3' }));

    expect(await resolvedor.resolver()).not.toBe(primeira);
  });

  it('descarta a instância quando só a chave muda', async () => {
    const ativo = provedorAtivo({
      tipo: TipoProvedorModelo.ANTHROPIC,
      baseUrl: null,
      chave: 'chave-antiga-de-teste',
    });
    const { servico, trocar } = configuracaoFalsa(ativo);
    const resolvedor = new ResolvedorDeProvedor(configFalsa(), servico);

    const primeira = await resolvedor.resolver();

    trocar({ ...ativo, chave: 'chave-nova-de-teste' });

    expect(await resolvedor.resolver()).not.toBe(primeira);
  });

  it('resolve a cada geração, sem recriar o app', async () => {
    const { servico, espiao, trocar } = configuracaoFalsa(null);
    const resolvedor = new ResolvedorDeProvedor(configFalsa(), servico);

    trocar(
      provedorAtivo({
        tipo: TipoProvedorModelo.ANTHROPIC,
        baseUrl: null,
        chave: null,
      }),
    );

    const eventos = [];

    for await (const evento of resolvedor.gerar({
      sistema: 'oi',
      mensagens: [{ papel: 'usuario', texto: 'oi' }],
      maxTokens: 10,
    })) {
      eventos.push(evento);
    }

    expect(espiao.provedorAtivo).toHaveBeenCalled();
    expect(eventos[0]).toMatchObject({ tipo: 'erro' });
  });

  it('devolve evento de erro em vez de estourar quando a configuração não monta', async () => {
    const { servico } = configuracaoFalsa(
      provedorAtivo({
        tipo: TipoProvedorModelo.ANTHROPIC,
        baseUrl: null,
        chave: null,
      }),
    );
    const resolvedor = new ResolvedorDeProvedor(configFalsa(), servico);

    const eventos = [];

    for await (const evento of resolvedor.gerar({
      sistema: 'oi',
      mensagens: [{ papel: 'usuario', texto: 'oi' }],
      maxTokens: 10,
    })) {
      eventos.push(evento);
    }

    expect(eventos).toEqual([
      {
        tipo: 'erro',
        codigo: 'provedor_indisponivel',
        mensagem: 'AnthropicProvider exige ANTHROPIC_API_KEY configurada',
        retomavel: false,
      },
    ]);
  });
});
