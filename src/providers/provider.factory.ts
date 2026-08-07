import { createHash } from 'node:crypto';
import { OraculoConfig } from '../config/config.service';
import { LlmProvider } from './llm-provider';
import { CliProvider } from './cli.provider';
import { AnthropicProvider } from './anthropic.provider';
import { OpenAiCompatProvider } from './openai-compat.provider';

export interface ExtrasDoProvedor {
  openaiCabecalhos?: Record<string, string>;
  openaiParametros?: Record<string, unknown>;
}

export type ConfigDoProvedor = OraculoConfig['provedor'] & ExtrasDoProvedor;

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

function ordenarProfundamente(valor: unknown): unknown {
  if (Array.isArray(valor)) {
    return valor.map(ordenarProfundamente);
  }

  if (typeof valor === 'object' && valor !== null) {
    return Object.fromEntries(
      Object.entries(valor as Record<string, unknown>)
        .sort(([esquerda], [direita]) => esquerda.localeCompare(direita))
        .map(([chave, item]) => [chave, ordenarProfundamente(item)]),
    );
  }

  return valor;
}

function resumoDeMapa(valor: Record<string, unknown> | undefined): string {
  if (!valor || Object.keys(valor).length === 0) {
    return '';
  }

  return JSON.stringify(ordenarProfundamente(valor));
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
    resumoDeMapa(config.openaiCabecalhos),
    resumoDeMapa(config.openaiParametros),
  ];

  return createHash('sha256').update(JSON.stringify(partes)).digest('hex');
}
