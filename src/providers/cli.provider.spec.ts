import { AnalisadorEventosCli } from './cli.provider';

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
