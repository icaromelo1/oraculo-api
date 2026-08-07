import { PROVEDORES_PADRAO, validarEnv } from './env.schema';

const base = {
  DATABASE_URL: 'postgres://oraculo:oraculo@localhost:5434/oraculo',
  JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
  CAP_CODIGO: 'off',
};

describe('PROVEDORES_PERMITIDOS — o teto de tipos de provedor', () => {
  it('permite os três tipos quando a variável não é informada', () => {
    expect(validarEnv({ ...base }).PROVEDORES_PERMITIDOS).toEqual(
      PROVEDORES_PADRAO.split(','),
    );
  });

  it('aceita uma lista recortada', () => {
    expect(
      validarEnv({ ...base, PROVEDORES_PERMITIDOS: 'cli, openai-compat' })
        .PROVEDORES_PERMITIDOS,
    ).toEqual(['cli', 'openai-compat']);
  });

  it('recusa tipo que não existe', () => {
    expect(() =>
      validarEnv({ ...base, PROVEDORES_PERMITIDOS: 'cli,ollama' }),
    ).toThrow(/PROVEDORES_PERMITIDOS/);
  });

  it('recusa lista vazia — instalação sem nenhum provedor não sobe', () => {
    expect(() => validarEnv({ ...base, PROVEDORES_PERMITIDOS: ' , ' })).toThrow(
      /PROVEDORES_PERMITIDOS/,
    );
  });

  it('recusa MODEL_PROVIDER fora da própria lista', () => {
    expect(() =>
      validarEnv({
        ...base,
        MODEL_PROVIDER: 'cli',
        PROVEDORES_PERMITIDOS: 'anthropic',
      }),
    ).toThrow(/está fora de PROVEDORES_PERMITIDOS/);
  });

  it('deixa subir quando MODEL_PROVIDER está na lista', () => {
    expect(
      validarEnv({
        ...base,
        MODEL_PROVIDER: 'cli',
        PROVEDORES_PERMITIDOS: 'cli',
      }).MODEL_PROVIDER,
    ).toBe('cli');
  });
});
