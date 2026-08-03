import { AnalisadorEventosAgy, construirArgvAgy } from './agy.analisador';
import { resolverDialeto } from './cli.provider';
import { PedidoGeracao } from './llm-provider';

const pedido: PedidoGeracao = {
  sistema: 'Você é o Oráculo.',
  mensagens: [{ papel: 'usuario', texto: 'oi' }],
  maxTokens: 100,
};

describe('AnalisadorEventosAgy', () => {
  it('emite texto do step_update de resposta do agente', () => {
    const analisador = new AnalisadorEventosAgy();
    const eventos = analisador.processarChunk(
      JSON.stringify({
        event: 'step_update',
        step_update: { step_type: 'agent_response', text_delta: 'resposta' },
      }) + '\n',
    );

    expect(eventos).toEqual([{ tipo: 'texto', fragmento: 'resposta' }]);
  });

  it('ignora passos que não são resposta do agente', () => {
    const analisador = new AnalisadorEventosAgy();
    const eventos = analisador.processarChunk(
      [
        JSON.stringify({ event: 'init', init: { model: 'x' } }),
        JSON.stringify({
          event: 'step_update',
          step_update: { step_type: 'checkpoint', text_delta: 'ignorar' },
        }),
        JSON.stringify({
          event: 'step_update',
          step_update: { step_type: 'user_input' },
        }),
        '',
      ].join('\n'),
    );

    expect(eventos).toEqual([]);
  });

  it('soma cache_read_tokens na entrada e converte duração para ms', () => {
    const analisador = new AnalisadorEventosAgy();
    const eventos = analisador.processarChunk(
      JSON.stringify({
        event: 'result',
        result: {
          status: 'SUCCESS',
          duration_seconds: 1.689325639,
          usage: {
            input_tokens: 10209,
            output_tokens: 4,
            cache_read_tokens: 8142,
          },
        },
      }) + '\n',
    );

    expect(eventos).toEqual([
      { tipo: 'fim', tokensEntrada: 18351, tokensSaida: 4, duracaoMs: 1689 },
    ]);
  });

  it('trata status diferente de SUCCESS como erro retomável', () => {
    const analisador = new AnalisadorEventosAgy();
    const eventos = analisador.processarChunk(
      JSON.stringify({
        event: 'result',
        result: { status: 'FAILED', usage: {} },
      }) + '\n',
    );

    expect(eventos).toEqual([
      {
        tipo: 'erro',
        codigo: 'agy_status_nao_sucesso',
        mensagem: 'agy terminou com status FAILED',
        retomavel: true,
      },
    ]);
  });

  it('acumula linha partida entre chunks', () => {
    const analisador = new AnalisadorEventosAgy();
    const linha = JSON.stringify({
      event: 'step_update',
      step_update: { step_type: 'agent_response', text_delta: 'inteiro' },
    });

    expect(analisador.processarChunk(linha.slice(0, 30))).toEqual([]);
    expect(analisador.processarChunk(linha.slice(30) + '\n')).toEqual([
      { tipo: 'texto', fragmento: 'inteiro' },
    ]);
  });

  it('ignora linha inválida sem derrubar o fluxo', () => {
    const analisador = new AnalisadorEventosAgy();
    const eventos = analisador.processarChunk(
      'nao é json\n' +
        JSON.stringify({
          event: 'step_update',
          step_update: { step_type: 'agent_response', text_delta: 'ok' },
        }) +
        '\n',
    );

    expect(eventos).toEqual([{ tipo: 'texto', fragmento: 'ok' }]);
  });
});

describe('construirArgvAgy', () => {
  it('monta os argumentos sem shell e com timeout em segundos', () => {
    const argv = construirArgvAgy(
      pedido,
      'gemini-3.6-flash-low',
      120_000,
      'prompt',
    );

    expect(argv).toEqual([
      '-p',
      'prompt',
      '--output-format',
      'stream-json',
      '--disable-slash-commands',
      '--print-timeout',
      '120s',
      '--model',
      'gemini-3.6-flash-low',
    ]);
  });

  it('omite o modelo quando não configurado', () => {
    expect(construirArgvAgy(pedido, '', 60_000, 'prompt')).not.toContain(
      '--model',
    );
  });
});

describe('resolverDialeto', () => {
  it('detecta agy pelo binário quando está em auto', () => {
    expect(resolverDialeto('auto', '/home/ubuntu/.local/bin/agy')).toBe('agy');
    expect(resolverDialeto('auto', 'claude')).toBe('claude');
  });

  it('respeita o dialeto explícito', () => {
    expect(resolverDialeto('claude', 'agy')).toBe('claude');
    expect(resolverDialeto('agy', 'claude')).toBe('agy');
  });
});
