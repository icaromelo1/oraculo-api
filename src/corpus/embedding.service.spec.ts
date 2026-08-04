import { prepararLote } from './embedding.service';

describe('prepararLote', () => {
  it('trunca texto gigante antes de chegar no tokenizer', () => {
    const [preparado] = prepararLote(['x'.repeat(50_000)], 'passage');

    expect(preparado?.length).toBe('passage: '.length + 2000);
  });

  it('mantém texto curto intacto e aplica o prefixo do e5', () => {
    expect(prepararLote(['como subo um serviço'], 'query')).toEqual([
      'query: como subo um serviço',
    ]);
  });
});
