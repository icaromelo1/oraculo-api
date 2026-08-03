const MAX_PALAVRAS = 8;
const MAX_CARACTERES = 80;

export function tituloDaConversa(pergunta: string): string {
  const normalizada = pergunta.trim().replace(/\s+/g, ' ');
  const todasAsPalavras = normalizada.split(' ');
  const palavras = todasAsPalavras.slice(0, MAX_PALAVRAS);
  const cortadoPorPalavra = palavras.length < todasAsPalavras.length;

  let titulo = palavras.join(' ');
  const cortadoPorTamanho = titulo.length > MAX_CARACTERES;

  if (cortadoPorTamanho) {
    titulo = titulo.slice(0, MAX_CARACTERES).trimEnd();
  }

  return cortadoPorTamanho || cortadoPorPalavra ? `${titulo}…` : titulo;
}
