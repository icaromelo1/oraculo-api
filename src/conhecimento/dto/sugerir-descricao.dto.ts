import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';

export const TAMANHO_MAXIMO_DO_CONTEUDO = 2 * 1024 * 1024;
export const TAMANHO_MAXIMO_DO_TITULO = 200;

export interface SugerirDescricaoDto {
  conteudo: string;
  titulo?: string;
}

export function validarSugerirDescricaoDto(
  corpo: unknown,
): SugerirDescricaoDto {
  if (typeof corpo !== 'object' || corpo === null || Array.isArray(corpo)) {
    throw new BadRequestException('corpo da requisição inválido');
  }

  const { conteudo, titulo } = corpo as Record<string, unknown>;

  if (typeof conteudo !== 'string') {
    throw new BadRequestException('"conteudo" precisa ser texto');
  }

  if (Buffer.byteLength(conteudo, 'utf-8') > TAMANHO_MAXIMO_DO_CONTEUDO) {
    throw new PayloadTooLargeException('"conteudo" passou do teto de 2 MB');
  }

  if (titulo !== undefined && titulo !== null && typeof titulo !== 'string') {
    throw new BadRequestException('"titulo" precisa ser texto');
  }

  const limpo =
    typeof titulo === 'string'
      ? titulo.trim().slice(0, TAMANHO_MAXIMO_DO_TITULO)
      : '';

  return limpo ? { conteudo, titulo: limpo } : { conteudo };
}
