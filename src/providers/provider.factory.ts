import { OraculoConfig } from '../config/config.service';
import { LlmProvider } from './llm-provider';
import { CliProvider } from './cli.provider';
import { AnthropicProvider } from './anthropic.provider';
import { OpenAiCompatProvider } from './openai-compat.provider';

export function criarLlmProvider(config: OraculoConfig): LlmProvider {
  const { tipo } = config.provedor;

  switch (tipo) {
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'openai-compat':
      return new OpenAiCompatProvider(config);
    case 'cli':
    default:
      return new CliProvider(config);
  }
}
