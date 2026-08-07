import { createHash } from 'node:crypto';
import { OraculoConfig } from '../config/config.service';
import { LlmProvider } from './llm-provider';
import { CliProvider } from './cli.provider';
import { AnthropicProvider } from './anthropic.provider';
import { OpenAiCompatProvider } from './openai-compat.provider';

export type ConfigDoProvedor = OraculoConfig['provedor'];

export function criarLlmProviderDe(config: ConfigDoProvedor): LlmProvider {
  switch (config.tipo) {
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'openai-compat':
      return new OpenAiCompatProvider(config);
    case 'cli':
    default:
      return new CliProvider(config);
  }
}

export function criarLlmProvider(config: OraculoConfig): LlmProvider {
  return criarLlmProviderDe(config.provedor);
}

function resumoDeSegredo(valor: string | undefined): string {
  if (!valor) {
    return '';
  }

  return createHash('sha256').update(valor).digest('hex');
}

export function impressaoDigital(config: ConfigDoProvedor): string {
  const partes = [
    config.tipo,
    config.cliComando,
    config.cliDialeto,
    config.cliModelo ?? '',
    String(config.cliTimeoutMs),
    config.anthropicModelo,
    config.openaiBaseUrl ?? '',
    config.openaiModelo ?? '',
    resumoDeSegredo(config.anthropicChave),
    resumoDeSegredo(config.openaiChave),
  ];

  return createHash('sha256').update(JSON.stringify(partes)).digest('hex');
}
