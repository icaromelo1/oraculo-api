import { lerBloco } from './protocolo';

describe('lerBloco', () => {
  it('le o formato canonico', () => {
    const leitura = lerBloco(
      '\n{"ferramenta":"ler_arquivo","argumentos":{"caminho":"/repos/a.ts"}}\n',
    );

    expect(leitura).toEqual({
      ok: true,
      pedido: {
        ferramenta: 'ler_arquivo',
        argumentos: { caminho: '/repos/a.ts' },
      },
    });
  });

  it('aceita bloco sem argumentos', () => {
    const leitura = lerBloco('{"ferramenta":"estado_servicos"}');

    expect(leitura).toEqual({
      ok: true,
      pedido: { ferramenta: 'estado_servicos', argumentos: {} },
    });
  });

  it('tolera texto solto em volta do JSON', () => {
    const leitura = lerBloco(
      'json\n{"ferramenta":"buscar_conhecimento","argumentos":{"consulta":"vm"}}\nvalendo',
    );

    expect(leitura.ok).toBe(true);
  });

  it('tolera virgula sobrando', () => {
    const leitura = lerBloco(
      '{"ferramenta":"buscar_conhecimento","argumentos":{"consulta":"vm"},}',
    );

    expect(leitura.ok).toBe(true);
  });

  it('recusa JSON quebrado sem lancar excecao', () => {
    const leitura = lerBloco('{ferramenta: buscar_conhecimento sem aspas');

    expect(leitura).toEqual({
      ok: false,
      motivo: 'o conteudo do bloco nao e um objeto JSON valido',
    });
  });

  it('recusa bloco vazio', () => {
    expect(lerBloco('   \n ').ok).toBe(false);
  });

  it('recusa objeto sem ferramenta', () => {
    expect(lerBloco('{"argumentos":{"consulta":"vm"}}')).toEqual({
      ok: false,
      motivo: 'falta o campo "ferramenta" (texto) no objeto JSON',
    });
  });

  it('recusa argumentos que nao sao objeto', () => {
    expect(lerBloco('{"ferramenta":"a","argumentos":[1,2]}')).toEqual({
      ok: false,
      motivo: 'o campo "argumentos" precisa ser um objeto JSON',
    });
  });
});
