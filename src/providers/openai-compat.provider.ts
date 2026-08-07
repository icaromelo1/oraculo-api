import { EventoProvedor, LlmProvider, PedidoGeracao } from './llm-provider';
import type { ConfigDoProvedor } from './provider.factory';
import {
  analisarJsonSeguro,
  ehObjeto,
  lerNumero,
  lerString,
} from './parsing-utils';

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
    const { openaiBaseUrl, openaiChave, openaiModelo } = this.config;
    const inicio = Date.now();

    const corpo = {
      model: openaiModelo,
      stream: true,
      max_tokens: pedido.maxTokens,
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
      resposta = await fetch(`${openaiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(openaiChave ? { authorization: `Bearer ${openaiChave}` } : {}),
        },
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
        mensagem: corpoErro || `Endpoint respondeu ${resposta.status}`,
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
