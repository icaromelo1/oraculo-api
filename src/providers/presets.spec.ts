import { TipoProvedorModelo } from '../database/entities';
import { PRESETS_DE_PROVEDOR, aplicarPreset, buscarPreset } from './presets';

describe('presets de provedor — catálogo', () => {
  it('tem id único e mantém groq como primeiro e manual como último', () => {
    const ids = PRESETS_DE_PROVEDOR.map((preset) => preset.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe('groq');
    expect(ids[ids.length - 1]).toBe('manual');
    expect(ids).toEqual(
      expect.arrayContaining(['deepseek', 'openrouter', 'ollama', 'xai']),
    );
  });

  it('todo preset que exige chave diz onde obtê-la', () => {
    for (const preset of PRESETS_DE_PROVEDOR) {
      if (!preset.exigeChave) continue;

      expect(preset.ondeObterChave).toMatch(/^https:\/\//);
    }
  });

  it('todo preset http declara baseUrl, menos o manual', () => {
    for (const preset of PRESETS_DE_PROVEDOR) {
      if (preset.id === 'manual' || preset.tipo === 'anthropic') continue;

      expect(preset.baseUrl).toMatch(/^https?:\/\//);
    }
  });

  it('declara baseUrl, chave e modelos sugeridos de cada fornecedor', () => {
    expect(buscarPreset('groq')).toMatchObject({
      baseUrl: 'https://api.groq.com/openai/v1',
      exigeChave: true,
    });
    expect(buscarPreset('deepseek')).toMatchObject({
      baseUrl: 'https://api.deepseek.com',
      exigeChave: true,
    });
    expect(buscarPreset('ollama')).toMatchObject({
      baseUrl: 'http://localhost:11434/v1',
      exigeChave: false,
    });
    expect(buscarPreset('manual')).toMatchObject({ baseUrl: null });

    for (const preset of PRESETS_DE_PROVEDOR) {
      if (preset.id === 'manual') {
        continue;
      }

      expect(preset.modelosSugeridos.length).toBeGreaterThan(0);
      expect(preset.modelosSugeridos.length).toBeLessThanOrEqual(3);
    }
  });

  it('o preset do OpenRouter traz os cabeçalhos que ele exige', () => {
    const cabecalhos = buscarPreset('openrouter')?.cabecalhos ?? {};

    expect(Object.keys(cabecalhos).sort()).toEqual(['HTTP-Referer', 'X-Title']);
    expect(cabecalhos['HTTP-Referer'].length).toBeGreaterThan(0);
    expect(cabecalhos['X-Title'].length).toBeGreaterThan(0);
  });
});

describe('aplicarPreset', () => {
  it('preenche baseUrl, modelo e cabeçalhos a partir do preset', () => {
    expect(aplicarPreset('openrouter', { nome: 'roteador' })).toMatchObject({
      tipo: TipoProvedorModelo.OPENAI_COMPAT,
      preset: 'openrouter',
      nome: 'roteador',
      baseUrl: 'https://openrouter.ai/api/v1',
      modelo: 'deepseek/deepseek-chat',
    });
  });

  it('o que o usuário informou vence o preset', () => {
    const cadastro = aplicarPreset('groq', {
      baseUrl: 'https://espelho.interno/v1',
      modelo: 'modelo-proprio',
      cabecalhosExtras: { 'X-Title': 'meu' },
    });

    expect(cadastro).toMatchObject({
      baseUrl: 'https://espelho.interno/v1',
      modelo: 'modelo-proprio',
      cabecalhosExtras: { 'X-Title': 'meu' },
    });
  });

  it('mescla o cabeçalho do usuário com o do preset', () => {
    const preset = buscarPreset('openrouter');
    const cabecalhos =
      aplicarPreset('openrouter', { cabecalhosExtras: { 'X-Title': 'meu' } })
        .cabecalhosExtras ?? {};

    expect(cabecalhos).toEqual({
      'HTTP-Referer': preset?.cabecalhos['HTTP-Referer'],
      'X-Title': 'meu',
    });
  });

  it('o preset manual não inventa baseUrl nem modelo', () => {
    const cadastro = aplicarPreset('manual');

    expect(cadastro.baseUrl).toBeUndefined();
    expect(cadastro.modelo).toBeUndefined();
    expect(cadastro.tipo).toBe(TipoProvedorModelo.OPENAI_COMPAT);
  });

  it('recusa preset desconhecido em vez de devolver cadastro vazio', () => {
    expect(() => aplicarPreset('inexistente')).toThrow(
      'preset de provedor desconhecido: inexistente',
    );
  });
});
