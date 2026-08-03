import { LIMITE_PADRAO, LIMITE_TETO, normalizarLimite } from './limite';

describe('normalizarLimite', () => {
  it('usa o padrão quando não informado', () => {
    expect(normalizarLimite(undefined)).toBe(LIMITE_PADRAO);
  });

  it('usa o padrão para valor não numérico', () => {
    expect(normalizarLimite('abacate')).toBe(LIMITE_PADRAO);
    expect(normalizarLimite(null)).toBe(LIMITE_PADRAO);
    expect(normalizarLimite(NaN)).toBe(LIMITE_PADRAO);
  });

  it('respeita um valor dentro da faixa', () => {
    expect(normalizarLimite(3)).toBe(3);
  });

  it('aceita número em formato texto', () => {
    expect(normalizarLimite('4')).toBe(4);
  });

  it('trunca o teto em 12', () => {
    expect(normalizarLimite(50)).toBe(LIMITE_TETO);
    expect(normalizarLimite(12)).toBe(LIMITE_TETO);
    expect(normalizarLimite(13)).toBe(LIMITE_TETO);
  });

  it('nunca devolve menos que 1', () => {
    expect(normalizarLimite(0)).toBe(1);
    expect(normalizarLimite(-5)).toBe(1);
  });

  it('trunca fração para inteiro', () => {
    expect(normalizarLimite(4.9)).toBe(4);
  });
});
