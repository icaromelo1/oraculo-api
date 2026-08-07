import { TipoProvedorModelo } from '../database/entities';

export interface PresetDeProvedor {
  id: string;
  rotulo: string;
  tipo: TipoProvedorModelo;
  baseUrl: string | null;
  exigeChave: boolean;
  cabecalhos: Record<string, string>;
  modelosSugeridos: string[];
  observacao: string | null;
}

export interface CadastroDeProvedor {
  tipo: TipoProvedorModelo;
  preset?: string;
  nome?: string;
  baseUrl?: string;
  modelo?: string;
  chave?: string;
  cabecalhosExtras?: Record<string, string>;
  parametros?: Record<string, unknown>;
}

export const PRESETS_DE_PROVEDOR: readonly PresetDeProvedor[] = [
  {
    id: 'groq',
    rotulo: 'Groq',
    tipo: TipoProvedorModelo.OPENAI_COMPAT,
    baseUrl: 'https://api.groq.com/openai/v1',
    exigeChave: true,
    cabecalhos: {},
    modelosSugeridos: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    observacao: 'camada gratuita',
  },
  {
    id: 'deepseek',
    rotulo: 'DeepSeek',
    tipo: TipoProvedorModelo.OPENAI_COMPAT,
    baseUrl: 'https://api.deepseek.com',
    exigeChave: true,
    cabecalhos: {},
    modelosSugeridos: ['deepseek-chat', 'deepseek-reasoner'],
    observacao: null,
  },
  {
    id: 'openrouter',
    rotulo: 'OpenRouter',
    tipo: TipoProvedorModelo.OPENAI_COMPAT,
    baseUrl: 'https://openrouter.ai/api/v1',
    exigeChave: true,
    cabecalhos: {
      'HTTP-Referer': 'https://icaromelodev.com.br/oraculo',
      'X-Title': 'Oráculo',
    },
    modelosSugeridos: [
      'deepseek/deepseek-chat',
      'meta-llama/llama-3.3-70b-instruct',
    ],
    observacao: 'pede HTTP-Referer e X-Title',
  },
  {
    id: 'ollama',
    rotulo: 'Ollama local',
    tipo: TipoProvedorModelo.OPENAI_COMPAT,
    baseUrl: 'http://localhost:11434/v1',
    exigeChave: false,
    cabecalhos: {},
    modelosSugeridos: ['llama3.2', 'qwen2.5-coder'],
    observacao: 'sem chave',
  },
  {
    id: 'manual',
    rotulo: 'Outro',
    tipo: TipoProvedorModelo.OPENAI_COMPAT,
    baseUrl: null,
    exigeChave: false,
    cabecalhos: {},
    modelosSugeridos: [],
    observacao: 'o usuário informa tudo',
  },
];

export function buscarPreset(id: string): PresetDeProvedor | undefined {
  return PRESETS_DE_PROVEDOR.find((preset) => preset.id === id);
}

export function aplicarPreset(
  id: string,
  parcial: Partial<CadastroDeProvedor> = {},
): CadastroDeProvedor {
  const preset = buscarPreset(id);
  if (!preset) {
    throw new Error(`preset de provedor desconhecido: ${id}`);
  }

  const baseUrl = parcial.baseUrl ?? preset.baseUrl ?? undefined;
  const modelo = parcial.modelo ?? preset.modelosSugeridos[0];
  const cabecalhos = {
    ...preset.cabecalhos,
    ...(parcial.cabecalhosExtras ?? {}),
  };

  return {
    tipo: parcial.tipo ?? preset.tipo,
    preset: preset.id,
    ...(parcial.nome ? { nome: parcial.nome } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(modelo ? { modelo } : {}),
    ...(parcial.chave ? { chave: parcial.chave } : {}),
    ...(Object.keys(cabecalhos).length > 0
      ? { cabecalhosExtras: cabecalhos }
      : {}),
    ...(parcial.parametros ? { parametros: parcial.parametros } : {}),
  };
}
