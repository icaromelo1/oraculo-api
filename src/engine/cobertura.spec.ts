import { calcularCobertura, limparMarcadores } from './cobertura';

const validos = new Set(['aaa111', 'bbb222']);

describe('calcularCobertura', () => {
  it('conta paragrafo citado e paragrafo sem fonte', () => {
    const texto = [
      'O motor roda na VM. [[F:aaa111]]',
      'Isso aqui eu inventei.',
      'E aqui tem duas fontes. [[F:aaa111]] [[F:bbb222]]',
    ].join('\n\n');

    expect(calcularCobertura(texto, validos)).toEqual({
      citadas: 2,
      total: 3,
      semFonte: 1,
    });
  });

  it('nao conta marcador invalido como cobertura', () => {
    expect(calcularCobertura('Afirmo isso. [[F:zzz999]]', validos)).toEqual({
      citadas: 0,
      total: 1,
      semFonte: 1,
    });
  });

  it('ignora paragrafo vazio', () => {
    expect(
      calcularCobertura('\n\n  \n\nunico. [[F:aaa111]]\n\n', validos),
    ).toEqual({
      citadas: 1,
      total: 1,
      semFonte: 0,
    });
  });

  it('resposta vazia nao tem paragrafo', () => {
    expect(calcularCobertura('', validos)).toEqual({
      citadas: 0,
      total: 0,
      semFonte: 0,
    });
  });
});

describe('limparMarcadores', () => {
  it('remove o que nao foi emitido e mantem o que foi', () => {
    expect(limparMarcadores('a [[F:aaa111]] b [[F:zzz999]] c', validos)).toBe(
      'a [[F:aaa111]] b  c',
    );
  });
});
