import { fundirComRrf, ItemFundivel } from './rrf';

interface ItemDeTeste extends ItemFundivel {
  rotulo: string;
}

function item(id: string, autoridade: number, rotulo = id): ItemDeTeste {
  return { id, autoridade, rotulo };
}

describe('fundirComRrf', () => {
  it('prioriza o item bem colocado nas duas listas', () => {
    const lexical = [item('a', 3), item('b', 3), item('c', 3)];
    const vetorial = [item('a', 3), item('c', 3), item('b', 3)];

    const fundidos = fundirComRrf([lexical, vetorial]);

    expect(fundidos.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('soma a contribuição de um item presente em apenas uma lista', () => {
    const lexical = [item('a', 3), item('b', 3)];
    const vetorial = [item('c', 3), item('a', 3)];

    const fundidos = fundirComRrf([lexical, vetorial]);

    expect(fundidos[0].id).toBe('a');
  });

  it('em empate de pontuação RRF, desempata pela autoridade da fonte (menor vence)', () => {
    const lexical = [item('memoria', 1), item('codigo', 3)];
    const vetorial = [item('codigo', 3), item('memoria', 1)];

    const fundidos = fundirComRrf([lexical, vetorial]);

    expect(fundidos.map((i) => i.id)).toEqual(['memoria', 'codigo']);
  });

  it('num empate de dois extremos com posições trocadas, autoridade 1 vence autoridade 3', () => {
    const lexical = [item('codigo', 3), item('doc', 2), item('memoria', 1)];
    const vetorial = [item('memoria', 1), item('doc', 2), item('codigo', 3)];

    const fundidos = fundirComRrf([lexical, vetorial]);

    expect(fundidos.map((i) => i.id)).toEqual(['memoria', 'codigo', 'doc']);
  });

  it('funciona com uma lista só (modo lexical ou vetorial puro)', () => {
    const unica = [item('x', 3), item('y', 1), item('z', 2)];

    const fundidos = fundirComRrf([unica]);

    expect(fundidos.map((i) => i.id)).toEqual(['x', 'y', 'z']);
  });

  it('não duplica um item presente nas duas listas', () => {
    const lexical = [item('a', 3)];
    const vetorial = [item('a', 3)];

    const fundidos = fundirComRrf([lexical, vetorial]);

    expect(fundidos).toHaveLength(1);
  });

  it('lida com listas vazias sem quebrar', () => {
    expect(fundirComRrf([[], []])).toEqual([]);
  });
});
