import { createHash } from 'node:crypto';
import { basename } from 'node:path';

export type Fonte = 'nota' | 'memoria' | 'agente' | 'doc' | 'config' | 'codigo';

export interface Procedencia {
  fonte: Fonte;
  autoridade: number;
  titulo: string;
  hash: string;
}

const PADRAO_NOTA = /(^|\/)notas\/[^/]+\.md$/i;
const PADRAO_MEMORIA =
  /(\.claude\/projects\/[^/]+\/memory\/[^/]+\.md$)|(\/memoria\/[^/]+\.md$)/i;
const PADRAO_AGENTE =
  /claude-workspace-config\/(agents|skills|claudicaro|workspace-agents)(\/|$)/i;
const PADRAO_CONFIG_VIVA =
  /(^|\/)(docker-compose[^/]*\.ya?ml|nginx\.conf)$|(^|\/)infra\//i;

function dentroDoDiretorioDeNotas(
  normalizado: string,
  diretorioNotas?: string,
): boolean {
  if (!diretorioNotas) return false;

  const raiz = diretorioNotas.replace(/\\/g, '/').replace(/\/+$/, '');

  return raiz.length > 0 && normalizado.startsWith(`${raiz}/`);
}

export function inferirFonte(
  caminho: string,
  diretorioNotas?: string,
): {
  fonte: Fonte;
  autoridade: number;
} {
  const normalizado = caminho.replace(/\\/g, '/');

  if (
    PADRAO_NOTA.test(normalizado) ||
    dentroDoDiretorioDeNotas(normalizado, diretorioNotas)
  ) {
    return { fonte: 'nota', autoridade: 1 };
  }

  if (PADRAO_MEMORIA.test(normalizado)) {
    return { fonte: 'memoria', autoridade: 1 };
  }

  if (PADRAO_AGENTE.test(normalizado)) {
    return { fonte: 'agente', autoridade: 1 };
  }

  if (PADRAO_CONFIG_VIVA.test(normalizado)) {
    return { fonte: 'config', autoridade: 3 };
  }

  if (normalizado.toLowerCase().endsWith('.md')) {
    return { fonte: 'doc', autoridade: 2 };
  }

  return { fonte: 'codigo', autoridade: 3 };
}

export function extrairTitulo(caminho: string, conteudo: string): string {
  const linhaHeading = conteudo
    .split('\n')
    .find((linha) => /^#{1,6}\s+\S/.test(linha));

  if (linhaHeading) {
    return linhaHeading.replace(/^#{1,6}\s+/, '').trim();
  }

  return basename(caminho);
}

export function calcularHash(conteudo: string): string {
  return createHash('sha256').update(conteudo).digest('hex');
}

export function construirProcedencia(
  caminho: string,
  conteudo: string,
  diretorioNotas?: string,
): Procedencia {
  const { fonte, autoridade } = inferirFonte(caminho, diretorioNotas);

  return {
    fonte,
    autoridade,
    titulo: extrairTitulo(caminho, conteudo),
    hash: calcularHash(conteudo),
  };
}
