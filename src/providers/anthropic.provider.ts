import Anthropic, {
  APIConnectionError,
  APIError,
  AuthenticationError,
  InternalServerError,
  RateLimitError,
} from '@anthropic-ai/sdk';
import { OraculoConfig } from '../config/config.service';
import { EventoProvedor, LlmProvider, PedidoGeracao } from './llm-provider';

function classificarErro(erro: unknown): string {
  if (erro instanceof RateLimitError) {
    return 'rate_limit';
  }
  if (erro instanceof AuthenticationError) {
    return 'autenticacao';
  }
  if (erro instanceof APIConnectionError) {
    return 'conexao';
  }
  if (erro instanceof APIError) {
    return `api_${erro.status ?? 'desconhecido'}`;
  }
  return 'desconhecido';
}

function ehRetomavel(erro: unknown): boolean {
  if (erro instanceof RateLimitError || erro instanceof APIConnectionError) {
    return true;
  }
  if (erro instanceof InternalServerError) {
    return true;
  }
  if (erro instanceof APIError) {
    return typeof erro.status === 'number' && erro.status >= 500;
  }
  return false;
}

export class AnthropicProvider implements LlmProvider {
  readonly nome = 'anthropic';

  private readonly cliente: Anthropic;

  constructor(private readonly config: OraculoConfig) {
    const { anthropicChave } = config.provedor;
    if (!anthropicChave) {
      throw new Error('AnthropicProvider exige ANTHROPIC_API_KEY configurada');
    }
    this.cliente = new Anthropic({ apiKey: anthropicChave });
  }

  async *gerar(pedido: PedidoGeracao): AsyncIterable<EventoProvedor> {
    const inicio = Date.now();

    const stream = this.cliente.messages.stream({
      model: this.config.provedor.anthropicModelo,
      max_tokens: pedido.maxTokens,
      system: pedido.sistema,
      messages: pedido.mensagens.map((mensagem) => ({
        role: mensagem.papel === 'usuario' ? 'user' : 'assistant',
        content: mensagem.texto,
      })),
    });

    try {
      for await (const evento of stream) {
        if (evento.type !== 'content_block_delta') {
          continue;
        }

        if (evento.delta.type === 'text_delta') {
          yield { tipo: 'texto', fragmento: evento.delta.text };
        } else if (evento.delta.type === 'thinking_delta') {
          yield { tipo: 'raciocinio', fragmento: evento.delta.thinking };
        }
      }

      const mensagemFinal = await stream.finalMessage();
      yield {
        tipo: 'fim',
        tokensEntrada: mensagemFinal.usage.input_tokens,
        tokensSaida: mensagemFinal.usage.output_tokens,
        duracaoMs: Date.now() - inicio,
      };
    } catch (erro) {
      yield {
        tipo: 'erro',
        codigo: classificarErro(erro),
        mensagem:
          erro instanceof Error
            ? erro.message
            : 'Erro desconhecido no provedor Anthropic',
        retomavel: ehRetomavel(erro),
      };
    }
  }
}
