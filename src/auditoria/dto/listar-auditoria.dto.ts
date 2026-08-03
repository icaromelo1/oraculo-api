import { BadRequestException } from '@nestjs/common';
import { CATEGORIAS_RESULTADO } from '../tipos';
import type { CategoriaResultado } from '../tipos';

const PAGINA_PADRAO = 1;
const POR_PAGINA_PADRAO = 25;
const POR_PAGINA_TETO = 100;

export class ListarAuditoriaDto {
  busca?: string;
  ferramenta?: string;
  resultado?: CategoriaResultado;
  de?: Date;
  ate?: Date;
  pagina: number = PAGINA_PADRAO;
  porPagina: number = POR_PAGINA_PADRAO;
}

function lerTexto(valor: unknown): string | undefined {
  if (typeof valor !== 'string') return undefined;

  const limpo = valor.trim();

  return limpo.length > 0 ? limpo : undefined;
}

function lerData(valor: unknown, campo: string): Date | undefined {
  const texto = lerTexto(valor);

  if (!texto) return undefined;

  const data = new Date(texto);

  if (Number.isNaN(data.getTime())) {
    throw new BadRequestException(`"${campo}" precisa ser uma data válida`);
  }

  return data;
}

function lerInteiroPositivo(
  valor: unknown,
  padrao: number,
  campo: string,
): number {
  if (valor === undefined || valor === null || valor === '') return padrao;

  const numero = Number(valor);

  if (!Number.isFinite(numero) || !Number.isInteger(numero) || numero < 1) {
    throw new BadRequestException(`"${campo}" precisa ser um inteiro positivo`);
  }

  return numero;
}

export function validarListarAuditoriaDto(query: unknown): ListarAuditoriaDto {
  const corpo = (query ?? {}) as Record<string, unknown>;
  const dto = new ListarAuditoriaDto();

  dto.busca = lerTexto(corpo.busca);
  dto.ferramenta = lerTexto(corpo.ferramenta);

  const resultado = lerTexto(corpo.resultado);

  if (resultado !== undefined) {
    if (!CATEGORIAS_RESULTADO.includes(resultado as CategoriaResultado)) {
      throw new BadRequestException(
        `"resultado" precisa ser um de: ${CATEGORIAS_RESULTADO.join(', ')}`,
      );
    }

    dto.resultado = resultado as CategoriaResultado;
  }

  dto.de = lerData(corpo.de, 'de');
  dto.ate = lerData(corpo.ate, 'ate');
  dto.pagina = lerInteiroPositivo(corpo.pagina, PAGINA_PADRAO, 'pagina');
  dto.porPagina = Math.min(
    lerInteiroPositivo(corpo.porPagina, POR_PAGINA_PADRAO, 'porPagina'),
    POR_PAGINA_TETO,
  );

  return dto;
}
