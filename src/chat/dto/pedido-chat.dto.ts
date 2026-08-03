import { BadRequestException } from '@nestjs/common';
import type { Escopo, PedidoChat } from '../../contracts/eventos';

function validarListaDeTexto(valor: unknown, campo: string): string[] {
  if (valor === undefined) {
    return [];
  }

  if (!Array.isArray(valor)) {
    throw new BadRequestException(`${campo} precisa ser uma lista de texto`);
  }

  const lista: unknown[] = valor;

  if (lista.some((item) => typeof item !== 'string')) {
    throw new BadRequestException(`${campo} precisa ser uma lista de texto`);
  }

  return lista as string[];
}

function validarEscopo(valor: unknown): Escopo | undefined {
  if (valor === undefined) {
    return undefined;
  }

  if (typeof valor !== 'object' || valor === null) {
    throw new BadRequestException('escopo inválido');
  }

  const { repositorios, alvos } = valor as Record<string, unknown>;

  return {
    repositorios: validarListaDeTexto(repositorios, 'escopo.repositorios'),
    alvos: validarListaDeTexto(alvos, 'escopo.alvos'),
  };
}

export function validarPedidoChatDto(corpo: unknown): PedidoChat {
  if (typeof corpo !== 'object' || corpo === null) {
    throw new BadRequestException('corpo da requisição inválido');
  }

  const { conversaId, pergunta, escopo } = corpo as Record<string, unknown>;

  if (typeof pergunta !== 'string' || pergunta.trim().length === 0) {
    throw new BadRequestException('pergunta é obrigatória');
  }

  if (conversaId !== undefined && typeof conversaId !== 'string') {
    throw new BadRequestException('conversaId inválido');
  }

  return {
    conversaId:
      typeof conversaId === 'string' && conversaId.trim()
        ? conversaId.trim()
        : undefined,
    pergunta: pergunta.trim(),
    escopo: validarEscopo(escopo),
  };
}
