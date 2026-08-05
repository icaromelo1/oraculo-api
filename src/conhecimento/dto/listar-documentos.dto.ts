import { BadRequestException } from '@nestjs/common';
import type { Fonte } from '../../corpus/procedencia';

const FONTES_DO_CORPUS: Fonte[] = [
  'nota',
  'memoria',
  'agente',
  'doc',
  'config',
  'codigo',
];

export const PAGINA_PADRAO = 1;
export const POR_PAGINA_PADRAO = 30;
export const POR_PAGINA_TETO = 100;
const AUTORIDADE_MINIMA = 1;
const AUTORIDADE_MAXIMA = 4;

export class ListarDocumentosDto {
  busca?: string;
  fonte?: Fonte;
  autoridade?: number;
  pasta?: string;
  recursivo: boolean = true;
  pagina: number = PAGINA_PADRAO;
  porPagina: number = POR_PAGINA_PADRAO;
}

function lerTexto(valor: unknown): string | undefined {
  if (typeof valor !== 'string') return undefined;

  const limpo = valor.trim();

  return limpo.length > 0 ? limpo : undefined;
}

function lerInteiro(valor: unknown, padrao: number, campo: string): number {
  if (valor === undefined || valor === null || valor === '') return padrao;

  const numero = Number(valor);

  if (!Number.isFinite(numero) || !Number.isInteger(numero) || numero < 1) {
    throw new BadRequestException(`"${campo}" precisa ser um inteiro positivo`);
  }

  return numero;
}

function lerAutoridade(valor: unknown): number | undefined {
  if (valor === undefined || valor === null || valor === '') return undefined;

  const numero = Number(valor);

  if (
    !Number.isInteger(numero) ||
    numero < AUTORIDADE_MINIMA ||
    numero > AUTORIDADE_MAXIMA
  ) {
    throw new BadRequestException(
      `"autoridade" precisa ser um inteiro entre ${AUTORIDADE_MINIMA} e ${AUTORIDADE_MAXIMA}`,
    );
  }

  return numero;
}

function lerPasta(valor: unknown): string | undefined {
  const texto = lerTexto(valor);

  if (texto === undefined) return undefined;

  if (!texto.startsWith('/') || texto.split('/').includes('..')) {
    throw new BadRequestException(
      '"pasta" precisa ser um caminho absoluto sem travessia de diretório',
    );
  }

  return texto;
}

function lerBooleano(valor: unknown, padrao: boolean): boolean {
  if (valor === undefined || valor === null || valor === '') return padrao;
  if (valor === true || valor === 'true') return true;
  if (valor === false || valor === 'false') return false;

  throw new BadRequestException('"recursivo" precisa ser true ou false');
}

export function validarListarDocumentosDto(
  query: unknown,
): ListarDocumentosDto {
  const corpo = (query ?? {}) as Record<string, unknown>;
  const dto = new ListarDocumentosDto();

  dto.busca = lerTexto(corpo.busca);
  dto.pasta = lerPasta(corpo.pasta);
  dto.recursivo = lerBooleano(corpo.recursivo, true);

  const fonte = lerTexto(corpo.fonte);

  if (fonte !== undefined) {
    if (!FONTES_DO_CORPUS.includes(fonte as Fonte)) {
      throw new BadRequestException(
        `"fonte" precisa ser uma de: ${FONTES_DO_CORPUS.join(', ')}`,
      );
    }

    dto.fonte = fonte as Fonte;
  }

  dto.autoridade = lerAutoridade(corpo.autoridade);
  dto.pagina = lerInteiro(corpo.pagina, PAGINA_PADRAO, 'pagina');
  dto.porPagina = Math.min(
    lerInteiro(corpo.porPagina, POR_PAGINA_PADRAO, 'porPagina'),
    POR_PAGINA_TETO,
  );

  return dto;
}
