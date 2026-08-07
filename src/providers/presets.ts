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
  ondeObterChave: string | null;
  gratuito: boolean;
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
    observacao: 'tem camada gratuita — bom lugar para começar',
    ondeObterChave: 'https://console.groq.com/keys',
    gratuito: true,
  },
  {
    id: 'deepseek',
    rotulo: 'DeepSeek',
    tipo: TipoProvedorModelo.OPENAI_COMPAT,
    baseUrl: 'https://api.deepseek.com',
    exigeChave: true,
    cabecalhos: {},
    modelosSugeridos: ['deepseek-chat', 'deepseek-reasoner'],
    observacao: 'muito barato por token, forte em seguir instrução',
    ondeObterChave: 'https://platform.deepseek.com/api_keys',
    gratuito: false,
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
    observacao:
      'uma chave só, dezenas de modelos — troque o modelo sem trocar credencial',
    ondeObterChave: 'https://openrouter.ai/keys',
    gratuito: false,
  },
  {
    id: 'ollama',
    rotulo: 'Ollama local',
    tipo: TipoProvedorModelo.OPENAI_COMPAT,
    baseUrl: 'http://localhost:11434/v1',
    exigeChave: false,
    cabecalhos: {},
    modelosSugeridos: ['llama3.2', 'qwen2.5-coder'],
    observacao:
      'roda na própria máquina, sem chave e sem custo — mas exige CPU/GPU local',
    ondeObterChave: null,
    gratuito: true,
  },
  {
    id: 'xai',
    rotulo: 'xAI (Grok)',
    tipo: TipoProvedorModelo.OPENAI_COMPAT,
    baseUrl: 'https://api.x.ai/v1',
    exigeChave: true,
    cabecalhos: {},
    modelosSugeridos: ['grok-4', 'grok-3-mini'],
    observacao: 'os modelos Grok, da xAI — não confundir com Groq',
    ondeObterChave: 'https://console.x.ai',
    gratuito: false,
  },
  {
    id: 'openai',
    rotulo: 'OpenAI',
    tipo: TipoProvedorModelo.OPENAI_COMPAT,
    baseUrl: 'https://api.openai.com/v1',
    exigeChave: true,
    cabecalhos: {},
    modelosSugeridos: ['gpt-5', 'gpt-5-mini'],
    observacao: null,
    ondeObterChave: 'https://platform.openai.com/api-keys',
    gratuito: false,
  },
  {
    id: 'mistral',
    rotulo: 'Mistral',
    tipo: TipoProvedorModelo.OPENAI_COMPAT,
    baseUrl: 'https://api.mistral.ai/v1',
    exigeChave: true,
    cabecalhos: {},
    modelosSugeridos: ['mistral-large-latest', 'mistral-small-latest'],
    observacao: null,
    ondeObterChave: 'https://console.mistral.ai/api-keys',
    gratuito: false,
  },
  {
    id: 'together',
    rotulo: 'Together AI',
    tipo: TipoProvedorModelo.OPENAI_COMPAT,
    baseUrl: 'https://api.together.xyz/v1',
    exigeChave: true,
    cabecalhos: {},
    modelosSugeridos: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'],
    observacao: 'catálogo grande de modelos abertos',
    ondeObterChave: 'https://api.together.xyz/settings/api-keys',
    gratuito: false,
  },
  {
    id: 'anthropic',
    rotulo: 'Anthropic (Claude)',
    tipo: TipoProvedorModelo.ANTHROPIC,
    baseUrl: null,
    exigeChave: true,
    cabecalhos: {},
    modelosSugeridos: ['claude-haiku-4-5-20251001'],
    observacao: 'usa a API própria da Anthropic, não o formato da OpenAI',
    ondeObterChave: 'https://console.anthropic.com/settings/keys',
    gratuito: false,
  },
  {
    id: 'manual',
    rotulo: 'Outro',
    tipo: TipoProvedorModelo.OPENAI_COMPAT,
    baseUrl: null,
    exigeChave: false,
    cabecalhos: {},
    modelosSugeridos: [],
    observacao: 'qualquer endpoint compatível com a API da OpenAI',
    ondeObterChave: null,
    gratuito: false,
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
