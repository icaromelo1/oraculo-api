import { EventoProvedor } from './llm-provider';
import { analisarJsonSeguro, ehObjeto, lerString } from './parsing-utils';

export type FormatoSaidaDialeto = 'texto-puro' | 'json-por-linha';

export interface DescritorDialeto {
  id: string;
  rotulo: string;
  argumentos: string[];
  formatoSaida: FormatoSaidaDialeto;
  caminhoTexto?: string;
  caminhoFinal?: string;
}

export interface ContextoArgumentos {
  prompt: string;
  promptComSistema: string;
  sistema: string;
  modelo: string;
  modeloOuPadrao: string;
  timeoutMs: number;
}

export type NomePreset = 'claude' | 'agy';

export type DialetoResolvido =
  | { origem: 'preset'; preset: NomePreset; descritor: DescritorDialeto }
  | { origem: 'personalizado'; descritor: DescritorDialeto };

export class ErroDialetoInvalido extends Error {
  constructor(motivo: string) {
    super(`dialeto personalizado inválido: ${motivo}`);
    this.name = 'ErroDialetoInvalido';
  }
}

export const DESCRITOR_CLAUDE: DescritorDialeto = {
  id: 'claude',
  rotulo: 'Claude Code',
  argumentos: [
    '-p',
    '{prompt}',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--strict-mcp-config',
    '--mcp-config',
    JSON.stringify({ mcpServers: {} }),
    '--model',
    '{modeloOuPadrao}',
    '--tools',
    'NenhumaFerramentaNativa',
    '--allowedTools',
    'FerramentaInexistente',
    '--exclude-dynamic-system-prompt-sections',
    '--system-prompt',
    '{sistema}',
  ],
  formatoSaida: 'json-por-linha',
};

export const DESCRITOR_AGY: DescritorDialeto = {
  id: 'agy',
  rotulo: 'Agy',
  argumentos: [
    '-p',
    '{promptComSistema}',
    '--output-format',
    'stream-json',
    '--disable-slash-commands',
    '--print-timeout',
    '{timeoutSegundos}s',
    '--model',
    '{modelo?}',
  ],
  formatoSaida: 'json-por-linha',
  caminhoTexto: 'step_update.text_delta',
  caminhoFinal: 'result.response',
};

const PRESETS: Record<NomePreset, DescritorDialeto> = {
  claude: DESCRITOR_CLAUDE,
  agy: DESCRITOR_AGY,
};

const MARCADOR = /\{([A-Za-z][A-Za-z0-9]*)(\?)?\}/g;

const MARCADORES_CONHECIDOS = [
  'prompt',
  'promptComSistema',
  'sistema',
  'modelo',
  'modeloOuPadrao',
  'timeoutMs',
  'timeoutSegundos',
];

const MARCADORES_DE_PROMPT = ['prompt', 'promptComSistema'];

const FORMATOS: FormatoSaidaDialeto[] = ['texto-puro', 'json-por-linha'];

const MAXIMO_ARGUMENTOS = 64;

const CAMINHO_VALIDO = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;

const SEGMENTOS_PROIBIDOS = ['__proto__', 'prototype', 'constructor'];

function ehPreset(valor: string): valor is NomePreset {
  return valor === 'claude' || valor === 'agy';
}

export function resolverDialeto(
  dialetoConfigurado: string,
  binario: string,
): DialetoResolvido {
  const informado = (dialetoConfigurado ?? '').trim();

  if (informado === '' || informado === 'auto') {
    const nome = binario.split('/').pop();
    const preset: NomePreset = nome === 'agy' ? 'agy' : 'claude';

    return { origem: 'preset', preset, descritor: PRESETS[preset] };
  }

  if (ehPreset(informado)) {
    return {
      origem: 'preset',
      preset: informado,
      descritor: PRESETS[informado],
    };
  }

  return {
    origem: 'personalizado',
    descritor: interpretarDescritor(informado),
  };
}

function marcadoresDe(modelo: string): { nome: string; opcional: boolean }[] {
  const encontrados: { nome: string; opcional: boolean }[] = [];

  for (const achado of modelo.matchAll(MARCADOR)) {
    encontrados.push({ nome: achado[1], opcional: achado[2] === '?' });
  }

  return encontrados;
}

function substituirMarcadores(
  modelo: string,
  valores: Record<string, string>,
): { texto: string; opcional: boolean } {
  let opcional = false;

  const texto = modelo.replace(
    MARCADOR,
    (inteiro: string, nome: string, interrogacao: string | undefined) => {
      const valor = valores[nome];

      if (valor === undefined) {
        return inteiro;
      }

      if (interrogacao === '?') {
        opcional = true;
      }

      return valor;
    },
  );

  return { texto, opcional };
}

function ehBandeira(modelo: string): boolean {
  return modelo.startsWith('-') && marcadoresDe(modelo).length === 0;
}

export function montarArgv(
  descritor: DescritorDialeto,
  contexto: ContextoArgumentos,
): string[] {
  const valores: Record<string, string> = {
    prompt: contexto.prompt,
    promptComSistema: contexto.promptComSistema,
    sistema: contexto.sistema,
    modelo: contexto.modelo,
    modeloOuPadrao: contexto.modeloOuPadrao,
    timeoutMs: String(contexto.timeoutMs),
    timeoutSegundos: String(Math.ceil(contexto.timeoutMs / 1000)),
  };

  const argv: string[] = [];

  for (let indice = 0; indice < descritor.argumentos.length; indice++) {
    const modelo = descritor.argumentos[indice];
    const { texto, opcional } = substituirMarcadores(modelo, valores);

    if (opcional && texto === '') {
      const anterior = descritor.argumentos[indice - 1];

      if (
        anterior !== undefined &&
        ehBandeira(anterior) &&
        argv[argv.length - 1] === anterior
      ) {
        argv.pop();
      }

      continue;
    }

    argv.push(texto);
  }

  return argv;
}

function exigirTexto(valor: unknown, campo: string): string {
  const texto = lerString(valor);

  if (texto === undefined || texto.trim() === '') {
    throw new ErroDialetoInvalido(`o campo "${campo}" precisa ser um texto`);
  }

  return texto;
}

function validarCaminho(valor: unknown, campo: string): string {
  const caminho = exigirTexto(valor, campo);

  if (!CAMINHO_VALIDO.test(caminho)) {
    throw new ErroDialetoInvalido(
      `o campo "${campo}" precisa ser um caminho como "passo.texto"`,
    );
  }

  if (
    caminho
      .split('.')
      .some((segmento) => SEGMENTOS_PROIBIDOS.includes(segmento))
  ) {
    throw new ErroDialetoInvalido(
      `o campo "${campo}" não pode navegar por ${SEGMENTOS_PROIBIDOS.join(', ')}`,
    );
  }

  return caminho;
}

function validarArgumentos(valor: unknown): string[] {
  if (!Array.isArray(valor) || valor.length === 0) {
    throw new ErroDialetoInvalido(
      'o campo "argumentos" precisa ser uma lista com ao menos um item',
    );
  }

  if (valor.length > MAXIMO_ARGUMENTOS) {
    throw new ErroDialetoInvalido(
      `o campo "argumentos" passa de ${MAXIMO_ARGUMENTOS} itens`,
    );
  }

  const argumentos = valor.map((item, indice) => {
    const texto = lerString(item);

    if (texto === undefined) {
      throw new ErroDialetoInvalido(
        `o item ${indice} de "argumentos" não é um texto`,
      );
    }

    return texto;
  });

  const usados = argumentos.flatMap((argumento) => marcadoresDe(argumento));
  const desconhecido = usados.find(
    (marcador) => !MARCADORES_CONHECIDOS.includes(marcador.nome),
  );

  if (desconhecido) {
    throw new ErroDialetoInvalido(
      `o marcador "{${desconhecido.nome}}" não existe — os conhecidos são ${MARCADORES_CONHECIDOS.join(', ')}`,
    );
  }

  if (
    !usados.some((marcador) => MARCADORES_DE_PROMPT.includes(marcador.nome))
  ) {
    throw new ErroDialetoInvalido(
      `"argumentos" precisa usar {${MARCADORES_DE_PROMPT.join('} ou {')}}`,
    );
  }

  return argumentos;
}

function validarFormato(valor: unknown): FormatoSaidaDialeto {
  const formato = lerString(valor);

  if (formato === undefined || !FORMATOS.includes(formato as never)) {
    throw new ErroDialetoInvalido(
      `o campo "formatoSaida" precisa ser ${FORMATOS.join(' ou ')}`,
    );
  }

  return formato as FormatoSaidaDialeto;
}

export function interpretarDescritor(bruto: string): DescritorDialeto {
  const analisado = analisarJsonSeguro(bruto);

  if (!ehObjeto(analisado) || Array.isArray(analisado)) {
    throw new ErroDialetoInvalido('não é um objeto JSON');
  }

  const id = exigirTexto(analisado.id, 'id');
  const rotulo = lerString(analisado.rotulo)?.trim() || id;
  const argumentos = validarArgumentos(analisado.argumentos);
  const formatoSaida = validarFormato(analisado.formatoSaida);

  if (formatoSaida === 'texto-puro') {
    return { id, rotulo, argumentos, formatoSaida };
  }

  const temTexto = analisado.caminhoTexto !== undefined;
  const temFinal = analisado.caminhoFinal !== undefined;

  if (!temTexto && !temFinal) {
    throw new ErroDialetoInvalido(
      'saída json-por-linha precisa de "caminhoTexto" ou "caminhoFinal"',
    );
  }

  return {
    id,
    rotulo,
    argumentos,
    formatoSaida,
    ...(temTexto
      ? { caminhoTexto: validarCaminho(analisado.caminhoTexto, 'caminhoTexto') }
      : {}),
    ...(temFinal
      ? { caminhoFinal: validarCaminho(analisado.caminhoFinal, 'caminhoFinal') }
      : {}),
  };
}

function lerCaminho(bruto: Record<string, unknown>, caminho: string): unknown {
  let atual: unknown = bruto;

  for (const segmento of caminho.split('.')) {
    if (!ehObjeto(atual) || !Object.hasOwn(atual, segmento)) {
      return undefined;
    }

    atual = atual[segmento];
  }

  return atual;
}

export class AnalisadorGenerico {
  private bufferizador = '';
  private emitiuTexto = false;
  private emitiuFim = false;

  constructor(private readonly descritor: DescritorDialeto) {}

  processarChunk(chunk: string): EventoProvedor[] {
    if (this.descritor.formatoSaida === 'texto-puro') {
      if (chunk === '') {
        return [];
      }

      this.emitiuTexto = true;

      return [{ tipo: 'texto', fragmento: chunk }];
    }

    this.bufferizador += chunk;
    const linhas = this.bufferizador.split('\n');
    this.bufferizador = linhas.pop() ?? '';

    const eventos: EventoProvedor[] = [];
    for (const linha of linhas) {
      eventos.push(...this.processarLinha(linha));
    }

    return eventos;
  }

  finalizar(): EventoProvedor[] {
    const eventos: EventoProvedor[] = [];
    const resto = this.bufferizador;
    this.bufferizador = '';

    if (resto.trim() !== '') {
      eventos.push(...this.processarLinha(resto));
    }

    if (!this.emitiuFim) {
      this.emitiuFim = true;
      eventos.push({
        tipo: 'fim',
        tokensEntrada: 0,
        tokensSaida: 0,
        duracaoMs: 0,
      });
    }

    return eventos;
  }

  private processarLinha(linha: string): EventoProvedor[] {
    const texto = linha.trim();
    if (texto === '') {
      return [];
    }

    const bruto = analisarJsonSeguro(texto);
    if (!ehObjeto(bruto)) {
      return [];
    }

    const { caminhoTexto, caminhoFinal } = this.descritor;

    const fragmento = caminhoTexto
      ? lerString(lerCaminho(bruto, caminhoTexto))
      : undefined;

    if (fragmento) {
      this.emitiuTexto = true;

      return [{ tipo: 'texto', fragmento }];
    }

    const completo = caminhoFinal
      ? lerString(lerCaminho(bruto, caminhoFinal))
      : undefined;

    if (completo === undefined) {
      return [];
    }

    const eventos: EventoProvedor[] = [];

    if (!this.emitiuTexto && completo !== '') {
      this.emitiuTexto = true;
      eventos.push({ tipo: 'texto', fragmento: completo });
    }

    if (!this.emitiuFim) {
      this.emitiuFim = true;
      eventos.push({
        tipo: 'fim',
        tokensEntrada: 0,
        tokensSaida: 0,
        duracaoMs: 0,
      });
    }

    return eventos;
  }
}
