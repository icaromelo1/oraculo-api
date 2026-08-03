import { tituloDaConversa } from './titulo-conversa';

describe('tituloDaConversa', () => {
  it('usa a pergunta inteira quando ela é curta', () => {
    expect(tituloDaConversa('qual a porta do postgres de teste?')).toBe(
      'qual a porta do postgres de teste?',
    );
  });

  it('trunca em 8 palavras e marca o corte com reticências', () => {
    const pergunta = 'uma duas tres quatro cinco seis sete oito nove dez';

    expect(tituloDaConversa(pergunta)).toBe(
      'uma duas tres quatro cinco seis sete oito…',
    );
  });

  it('trunca por tamanho quando a(s) palavra(s) são muito longas', () => {
    const palavraGigante = 'a'.repeat(100);
    const titulo = tituloDaConversa(palavraGigante);

    expect(titulo.endsWith('…')).toBe(true);
    expect(titulo.length).toBeLessThanOrEqual(81);
  });

  it('normaliza espaços múltiplos antes de cortar', () => {
    expect(tituloDaConversa('  ola    mundo  ')).toBe('ola mundo');
  });
});
