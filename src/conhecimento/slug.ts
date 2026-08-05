import { basename, extname } from 'node:path';

export const TAMANHO_MAXIMO_SLUG = 80;

const PADRAO_SLUG = /^[a-z0-9][a-z0-9-]*$/;
const ACENTOS = /[\u0300-\u036f]/g;
const NAO_ALFANUMERICO = /[^a-z0-9]+/g;
const HIFENS_NAS_PONTAS = /^-+|-+$/g;

export function gerarSlug(texto: string): string {
  const normalizado = texto
    .normalize('NFD')
    .replace(ACENTOS, '')
    .toLowerCase()
    .replace(NAO_ALFANUMERICO, '-')
    .replace(HIFENS_NAS_PONTAS, '')
    .slice(0, TAMANHO_MAXIMO_SLUG)
    .replace(HIFENS_NAS_PONTAS, '');

  return normalizado || 'nota';
}

export function slugDoNomeDeArquivo(nome: string): string {
  const semDiretorio = basename(nome.replace(/\\/g, '/'));

  return gerarSlug(basename(semDiretorio, extname(semDiretorio)));
}

export function slugSeguro(valor: unknown): valor is string {
  if (typeof valor !== 'string') {
    return false;
  }

  return valor.length <= TAMANHO_MAXIMO_SLUG && PADRAO_SLUG.test(valor);
}

export function proximoSlug(base: string, tentativa: number): string {
  return tentativa <= 1 ? base : `${base}-${tentativa}`;
}
