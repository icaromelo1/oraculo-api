import {
  AnalisadorGenerico,
  DESCRITOR_AGY,
  DESCRITOR_CLAUDE,
  ErroDialetoInvalido,
  interpretarDescritor,
  montarArgv,
  resolverDialeto,
} from './dialeto';
import type { ContextoArgumentos } from './dialeto';

const SISTEMA = 'Você é o Oráculo.';
const PROMPT = 'usuario: oi';

function contexto(
  parcial: Partial<ContextoArgumentos> = {},
): ContextoArgumentos {
  return {
    prompt: PROMPT,
    promptComSistema: `${SISTEMA}\n\n${PROMPT}`,
    sistema: SISTEMA,
    modelo: 'gemini-3.6-flash-low',
    modeloOuPadrao: 'gemini-3.6-flash-low',
    timeoutMs: 120_000,
    ...parcial,
  };
}

describe('preset claude', () => {
  it('produz exatamente o argv de antes do descritor', () => {
    const argv = montarArgv(
      DESCRITOR_CLAUDE,
      contexto({ modelo: '', modeloOuPadrao: 'claude-haiku-4-5-20251001' }),
    );

    expect(argv).toEqual([
      '-p',
      PROMPT,
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
      SISTEMA,
    ]);
  });

  it('mantém as flags de segurança mesmo sem modelo configurado', () => {
    const argv = montarArgv(
      DESCRITOR_CLAUDE,
      contexto({ modelo: '', modeloOuPadrao: '' }),
    );

    expect(argv).toContain('--strict-mcp-config');
    expect(argv).toContain('--tools');
    expect(argv).toContain('--allowedTools');
    expect(argv).toContain('--exclude-dynamic-system-prompt-sections');
    expect(argv[argv.indexOf('--model') + 1]).toBe('');
  });
});

describe('preset agy', () => {
  it('produz exatamente o argv de antes do descritor', () => {
    const argv = montarArgv(DESCRITOR_AGY, contexto());

    expect(argv).toEqual([
      '-p',
      `${SISTEMA}\n\n${PROMPT}`,
      '--output-format',
      'stream-json',
      '--disable-slash-commands',
      '--print-timeout',
      '120s',
      '--model',
      'gemini-3.6-flash-low',
    ]);
  });

  it('some com o par de argumentos quando o modelo está vazio', () => {
    const argv = montarArgv(
      DESCRITOR_AGY,
      contexto({ modelo: '', modeloOuPadrao: '', timeoutMs: 60_000 }),
    );

    expect(argv).toEqual([
      '-p',
      `${SISTEMA}\n\n${PROMPT}`,
      '--output-format',
      'stream-json',
      '--disable-slash-commands',
      '--print-timeout',
      '60s',
    ]);
  });

  it('nunca passa --dangerously-skip-permissions', () => {
    expect(montarArgv(DESCRITOR_AGY, contexto())).not.toContain(
      '--dangerously-skip-permissions',
    );
  });
});

describe('resolverDialeto', () => {
  it('detecta o preset pelo binário quando está em auto', () => {
    expect(resolverDialeto('auto', '/usr/bin/agy')).toEqual({
      origem: 'preset',
      preset: 'agy',
      descritor: DESCRITOR_AGY,
    });
    expect(resolverDialeto('', 'claude')).toEqual({
      origem: 'preset',
      preset: 'claude',
      descritor: DESCRITOR_CLAUDE,
    });
  });

  it('lê um descritor personalizado a partir do JSON do provedor', () => {
    const resolvido = resolverDialeto(
      JSON.stringify({
        id: 'meucli',
        rotulo: 'Meu CLI',
        argumentos: ['--ask', '{prompt}'],
        formatoSaida: 'texto-puro',
      }),
      'meucli',
    );

    expect(resolvido.origem).toBe('personalizado');
    expect(resolvido.descritor.rotulo).toBe('Meu CLI');
    expect(montarArgv(resolvido.descritor, contexto())).toEqual([
      '--ask',
      PROMPT,
    ]);
  });
});

describe('descritor personalizado inválido', () => {
  const invalidos: [string, string][] = [
    ['JSON quebrado', '{ não é json'],
    ['não é objeto', '"claude"'],
    ['sem id', JSON.stringify({ argumentos: ['{prompt}'] })],
    ['argumentos vazios', JSON.stringify({ id: 'x', argumentos: [] })],
    [
      'argumento que não é texto',
      JSON.stringify({
        id: 'x',
        argumentos: ['{prompt}', 7],
        formatoSaida: 'texto-puro',
      }),
    ],
    [
      'sem marcador de prompt',
      JSON.stringify({
        id: 'x',
        argumentos: ['--tudo'],
        formatoSaida: 'texto-puro',
      }),
    ],
    [
      'marcador desconhecido',
      JSON.stringify({
        id: 'x',
        argumentos: ['{prompt}', '{chaveSecreta}'],
        formatoSaida: 'texto-puro',
      }),
    ],
    [
      'formato desconhecido',
      JSON.stringify({
        id: 'x',
        argumentos: ['{prompt}'],
        formatoSaida: 'xml',
      }),
    ],
    [
      'json-por-linha sem caminho',
      JSON.stringify({
        id: 'x',
        argumentos: ['{prompt}'],
        formatoSaida: 'json-por-linha',
      }),
    ],
    [
      'caminho navegando por protótipo',
      JSON.stringify({
        id: 'x',
        argumentos: ['{prompt}'],
        formatoSaida: 'json-por-linha',
        caminhoTexto: '__proto__.texto',
      }),
    ],
    [
      'caminho com sintaxe estranha',
      JSON.stringify({
        id: 'x',
        argumentos: ['{prompt}'],
        formatoSaida: 'json-por-linha',
        caminhoTexto: 'a[0].b',
      }),
    ],
  ];

  it.each(invalidos)('recusa com erro claro: %s', (_titulo, bruto) => {
    expect(() => interpretarDescritor(bruto)).toThrow(ErroDialetoInvalido);
  });

  it('recusa uma lista de argumentos absurda', () => {
    const argumentos = ['{prompt}', ...Array<string>(80).fill('--x')];

    expect(() =>
      interpretarDescritor(
        JSON.stringify({ id: 'x', argumentos, formatoSaida: 'texto-puro' }),
      ),
    ).toThrow(ErroDialetoInvalido);
  });
});

describe('AnalisadorGenerico', () => {
  it('em texto-puro devolve o que sai do processo como texto', () => {
    const analisador = new AnalisadorGenerico({
      id: 'x',
      rotulo: 'X',
      argumentos: ['{prompt}'],
      formatoSaida: 'texto-puro',
    });

    expect(analisador.processarChunk('resposta ')).toEqual([
      { tipo: 'texto', fragmento: 'resposta ' },
    ]);
    expect(analisador.processarChunk('em partes')).toEqual([
      { tipo: 'texto', fragmento: 'em partes' },
    ]);
    expect(analisador.finalizar()).toEqual([
      { tipo: 'fim', tokensEntrada: 0, tokensSaida: 0, duracaoMs: 0 },
    ]);
  });

  it('em json-por-linha extrai o texto pelo caminhoTexto', () => {
    const analisador = new AnalisadorGenerico({
      id: 'x',
      rotulo: 'X',
      argumentos: ['{prompt}'],
      formatoSaida: 'json-por-linha',
      caminhoTexto: 'passo.saida.texto',
    });

    const eventos = analisador.processarChunk(
      [
        JSON.stringify({ passo: { saida: { texto: 'olá' } } }),
        JSON.stringify({ passo: { outro: 'ignorado' } }),
        'nem json',
        '',
      ].join('\n'),
    );

    expect(eventos).toEqual([{ tipo: 'texto', fragmento: 'olá' }]);
  });

  it('acumula linha partida entre chunks e aproveita a última sem quebra', () => {
    const analisador = new AnalisadorGenerico({
      id: 'x',
      rotulo: 'X',
      argumentos: ['{prompt}'],
      formatoSaida: 'json-por-linha',
      caminhoTexto: 'texto',
    });

    const linha = JSON.stringify({ texto: 'inteiro' });

    expect(analisador.processarChunk(linha.slice(0, 5))).toEqual([]);
    expect(analisador.processarChunk(linha.slice(5))).toEqual([]);
    expect(analisador.finalizar()).toEqual([
      { tipo: 'texto', fragmento: 'inteiro' },
      { tipo: 'fim', tokensEntrada: 0, tokensSaida: 0, duracaoMs: 0 },
    ]);
  });

  it('usa o caminhoFinal como resposta quando não houve fragmento', () => {
    const analisador = new AnalisadorGenerico({
      id: 'x',
      rotulo: 'X',
      argumentos: ['{prompt}'],
      formatoSaida: 'json-por-linha',
      caminhoTexto: 'step_update.text_delta',
      caminhoFinal: 'result.response',
    });

    const eventos = analisador.processarChunk(
      JSON.stringify({ result: { response: 'resposta inteira' } }) + '\n',
    );

    expect(eventos).toEqual([
      { tipo: 'texto', fragmento: 'resposta inteira' },
      { tipo: 'fim', tokensEntrada: 0, tokensSaida: 0, duracaoMs: 0 },
    ]);
  });

  it('não repete a resposta quando os fragmentos já vieram', () => {
    const analisador = new AnalisadorGenerico({
      id: 'x',
      rotulo: 'X',
      argumentos: ['{prompt}'],
      formatoSaida: 'json-por-linha',
      caminhoTexto: 'step_update.text_delta',
      caminhoFinal: 'result.response',
    });

    const eventos = analisador.processarChunk(
      [
        JSON.stringify({ step_update: { text_delta: 'peda' } }),
        JSON.stringify({ step_update: { text_delta: 'ço' } }),
        JSON.stringify({ result: { response: 'pedaço' } }),
        '',
      ].join('\n'),
    );

    expect(eventos).toEqual([
      { tipo: 'texto', fragmento: 'peda' },
      { tipo: 'texto', fragmento: 'ço' },
      { tipo: 'fim', tokensEntrada: 0, tokensSaida: 0, duracaoMs: 0 },
    ]);
  });
});

describe('marcador não é porta de injeção', () => {
  it('não reinterpreta marcador que veio dentro do prompt do usuário', () => {
    const argv = montarArgv(
      DESCRITOR_AGY,
      contexto({
        promptComSistema: 'me diga {sistema} e {modelo} agora',
      }),
    );

    expect(argv[1]).toBe('me diga {sistema} e {modelo} agora');
  });

  it('mantém cada peça do template como um elemento só do argv', () => {
    const descritor = interpretarDescritor(
      JSON.stringify({
        id: 'malicioso',
        argumentos: ['--ask', '{prompt}', '; rm -rf /', '$(whoami)', '&& curl'],
        formatoSaida: 'texto-puro',
      }),
    );

    const argv = montarArgv(
      descritor,
      contexto({ prompt: 'oi; rm -rf / && echo $(id)' }),
    );

    expect(argv).toEqual([
      '--ask',
      'oi; rm -rf / && echo $(id)',
      '; rm -rf /',
      '$(whoami)',
      '&& curl',
    ]);
  });
});
