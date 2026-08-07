import { RedactionService } from '../security/redaction.service';
import { EventoProvedor, LlmProvider, PedidoGeracao } from './llm-provider';
import type { ConfigDoProvedor } from './provider.factory';
import {
  analisarJsonSeguro,
  ehObjeto,
  lerNumero,
  lerString,
} from './parsing-utils';

const CABECALHOS_RESERVADOS = new Set(['authorization', 'content-type']);
const CAMPOS_RESERVADOS = new Set(['model', 'stream', 'messages']);
const CHAVE_CAMPO_MAX_TOKENS = 'campoMaxTokens';
const CAMPO_MAX_TOKENS_PADRAO = 'max_tokens';
const NOME_DE_CAMPO = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const LIMITE_DA_MENSAGEM_DE_ERRO = 500;
const SUFIXO_DO_ENDPOINT = '/chat/completions';

const redacao = new RedactionService();

export function montarUrlDeChat(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');

  return base.toLowerCase().endsWith(SUFIXO_DO_ENDPOINT)
    ? base
    : `${base}${SUFIXO_DO_ENDPOINT}`;
}

function mesclarCabecalhos(
  base: Record<string, string>,
  extras: Record<string, string> | undefined,
): Record<string, string> {
  const mesclados: Record<string, string> = {};

  for (const [chave, valor] of Object.entries(extras ?? {})) {
    const nome = chave.trim();
    if (!nome || CABECALHOS_RESERVADOS.has(nome.toLowerCase())) {
      continue;
    }

    if (typeof valor === 'string') {
      mesclados[nome] = valor;
    }
  }

  return { ...mesclados, ...base };
}

function campoDeMaxTokens(
  parametros: Record<string, unknown> | undefined,
): string {
  const escolhido = lerString(parametros?.[CHAVE_CAMPO_MAX_TOKENS]);
  if (
    !escolhido ||
    !NOME_DE_CAMPO.test(escolhido) ||
    CAMPOS_RESERVADOS.has(escolhido.toLowerCase())
  ) {
    return CAMPO_MAX_TOKENS_PADRAO;
  }

  return escolhido;
}

function parametrosDoCorpo(
  parametros: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const aproveitados: Record<string, unknown> = {};

  for (const [chave, valor] of Object.entries(parametros ?? {})) {
    const nome = chave.trim();
    if (
      !nome ||
      nome === CHAVE_CAMPO_MAX_TOKENS ||
      CAMPOS_RESERVADOS.has(nome.toLowerCase())
    ) {
      continue;
    }

    aproveitados[nome] = valor;
  }

  return aproveitados;
}

function detalharErro(bruto: string): string {
  const json = analisarJsonSeguro(bruto);
  if (!ehObjeto(json)) {
    return bruto.trim();
  }

  const erro = json.error;
  const mensagem =
    (ehObjeto(erro) ? lerString(erro.message) : undefined) ??
    lerString(erro) ??
    lerString(json.message) ??
    lerString(json.detail);

  return (mensagem ?? bruto).trim();
}

export function descreverErroHttp(
  status: number,
  situacao: string,
  bruto: string,
  chave: string | undefined,
): string {
  const rotulo = situacao.trim()
    ? `${status} ${situacao.trim()}`
    : String(status);
  const detalhe = detalharErro(bruto);
  if (!detalhe) {
    return `Endpoint respondeu ${rotulo}`;
  }

  const semChave =
    chave && chave.length >= 8
      ? detalhe.split(chave).join('[oculto:token]')
      : detalhe;
  const redigido = redacao.redigir(semChave).texto;
  const encurtado =
    redigido.length > LIMITE_DA_MENSAGEM_DE_ERRO
      ? `${redigido.slice(0, LIMITE_DA_MENSAGEM_DE_ERRO)}…`
      : redigido;

  return `Endpoint respondeu ${rotulo}: ${encurtado}`;
}

function interpretarLinhaSse(
  linha: string,
): Record<string, unknown> | undefined {
  const texto = linha.trim();
  if (!texto.startsWith('data:')) {
    return undefined;
  }

  const dados = texto.slice('data:'.length).trim();
  if (dados === '[DONE]') {
    return undefined;
  }

  const bruto = analisarJsonSeguro(dados);
  return ehObjeto(bruto) ? bruto : undefined;
}

function extrairFragmentos(json: Record<string, unknown>): EventoProvedor[] {
  const eventos: EventoProvedor[] = [];
  const escolhas = json.choices;
  if (!Array.isArray(escolhas)) {
    return eventos;
  }

  for (const escolha of escolhas) {
    if (!ehObjeto(escolha) || !ehObjeto(escolha.delta)) {
      continue;
    }

    const delta = escolha.delta;
    const fragmentoTexto = lerString(delta.content);
    if (fragmentoTexto !== undefined) {
      eventos.push({ tipo: 'texto', fragmento: fragmentoTexto });
    }

    const fragmentoRaciocinio =
      lerString(delta.reasoning_content) ?? lerString(delta.reasoning);
    if (fragmentoRaciocinio !== undefined) {
      eventos.push({ tipo: 'raciocinio', fragmento: fragmentoRaciocinio });
    }
  }

  return eventos;
}

export class OpenAiCompatProvider implements LlmProvider {
  readonly nome = 'openai-compat';

  constructor(private readonly config: ConfigDoProvedor) {
    const { openaiBaseUrl, openaiModelo } = config;
    if (!openaiBaseUrl || !openaiModelo) {
      throw new Error(
        'OpenAiCompatProvider exige OPENAI_BASE_URL e OPENAI_MODELO configurados',
      );
    }
  }

  async *gerar(pedido: PedidoGeracao): AsyncIterable<EventoProvedor> {
    const {
      openaiBaseUrl,
      openaiChave,
      openaiModelo,
      openaiCabecalhos,
      openaiParametros,
    } = this.config;
    const inicio = Date.now();

    const corpo: Record<string, unknown> = {
      ...parametrosDoCorpo(openaiParametros),
      model: openaiModelo,
      stream: true,
      [campoDeMaxTokens(openaiParametros)]: pedido.maxTokens,
      messages: [
        { role: 'system', content: pedido.sistema },
        ...pedido.mensagens.map((mensagem) => ({
          role: mensagem.papel === 'usuario' ? 'user' : 'assistant',
          content: mensagem.texto,
        })),
      ],
    };

    let resposta: Response;
    try {
      resposta = await fetch(montarUrlDeChat(openaiBaseUrl ?? ''), {
        method: 'POST',
        headers: mesclarCabecalhos(
          {
            'content-type': 'application/json',
            ...(openaiChave ? { authorization: `Bearer ${openaiChave}` } : {}),
          },
          openaiCabecalhos,
        ),
        body: JSON.stringify(corpo),
      });
    } catch (erro) {
      yield {
        tipo: 'erro',
        codigo: 'openai_conexao_falhou',
        mensagem:
          erro instanceof Error
            ? erro.message
            : 'Falha ao conectar ao endpoint OpenAI-compatível',
        retomavel: true,
      };
      return;
    }

    if (!resposta.ok || !resposta.body) {
      const corpoErro = await resposta.text().catch(() => '');
      yield {
        tipo: 'erro',
        codigo: `openai_http_${resposta.status}`,
        mensagem: descreverErroHttp(
          resposta.status,
          resposta.statusText ?? '',
          corpoErro,
          openaiChave,
        ),
        retomavel: resposta.status >= 500 || resposta.status === 429,
      };
      return;
    }

    const leitor = resposta.body.getReader();
    const decodificador = new TextDecoder('utf-8');
    let bufferizador = '';
    let tokensEntrada = 0;
    let tokensSaida = 0;

    try {
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) {
          break;
        }

        bufferizador += decodificador.decode(value, { stream: true });
        const linhas = bufferizador.split('\n');
        bufferizador = linhas.pop() ?? '';

        for (const linha of linhas) {
          const json = interpretarLinhaSse(linha);
          if (!json) {
            continue;
          }

          const usage = json.usage;
          if (ehObjeto(usage)) {
            tokensEntrada = lerNumero(usage.prompt_tokens) ?? tokensEntrada;
            tokensSaida = lerNumero(usage.completion_tokens) ?? tokensSaida;
          }

          for (const evento of extrairFragmentos(json)) {
            yield evento;
          }
        }
      }
    } catch (erro) {
      yield {
        tipo: 'erro',
        codigo: 'openai_stream_falhou',
        mensagem:
          erro instanceof Error
            ? erro.message
            : 'Falha ao ler o stream do endpoint OpenAI-compatível',
        retomavel: true,
      };
      return;
    }

    yield {
      tipo: 'fim',
      tokensEntrada,
      tokensSaida,
      duracaoMs: Date.now() - inicio,
    };
  }
}
