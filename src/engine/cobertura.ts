import type { Cobertura } from '../contracts/eventos';

const CORPO_MARCADOR = '\\[\\[F:([A-Za-z0-9_-]{1,64})\\]\\]';

export function marcador(): RegExp {
  return new RegExp(CORPO_MARCADOR, 'g');
}

export function marcadorParcial(texto: string): number {
  const abertura = texto.lastIndexOf('[[');

  if (abertura >= 0 && texto.indexOf(']]', abertura) < 0) {
    return abertura;
  }

  return texto.endsWith('[') ? texto.length - 1 : texto.length;
}

export function limparMarcadores(
  texto: string,
  validos: ReadonlySet<string>,
): string {
  return texto.replace(marcador(), (todo, id: string) =>
    validos.has(id) ? todo : '',
  );
}

function idsCitados(texto: string): string[] {
  return [...texto.matchAll(marcador())].map((achado) => achado[1]);
}

export function calcularCobertura(
  texto: string,
  validos: ReadonlySet<string>,
): Cobertura {
  const paragrafos = texto
    .split(/\n\s*\n/)
    .map((paragrafo) => paragrafo.trim())
    .filter(Boolean);

  const citadas = paragrafos.filter((paragrafo) =>
    idsCitados(paragrafo).some((id) => validos.has(id)),
  ).length;

  return {
    citadas,
    total: paragrafos.length,
    semFonte: paragrafos.length - citadas,
  };
}
