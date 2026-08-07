import {
  encurtarTrecho,
  TETO_DE_TRECHO_CHARS,
} from './buscar-conhecimento.capacidade';
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

describe('teto de tamanho do trecho devolvido ao modelo', () => {
  it('não mexe em trecho dentro do teto', () => {
    const curto = 'linha um\nlinha dois';

    expect(encurtarTrecho(curto)).toBe(curto);
  });

  it('corta trecho gigante e avisa que foi cortado', () => {
    const gigante = 'a'.repeat(50_000);
    const saida = encurtarTrecho(gigante);

    expect(saida.length).toBeLessThan(TETO_DE_TRECHO_CHARS + 100);
    expect(saida).toContain('trecho cortado');
  });

  it('prefere cortar na quebra de linha para não partir no meio da palavra', () => {
    const texto = 'x'.repeat(1_500) + '\n' + 'y'.repeat(1_000);
    const saida = encurtarTrecho(texto);

    expect(saida.startsWith('x'.repeat(1_500))).toBe(true);
    expect(saida).not.toContain('y');
  });
});
