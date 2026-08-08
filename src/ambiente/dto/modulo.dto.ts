import { BadRequestException } from '@nestjs/common';
import type {
  EdicaoDeModulo,
  NovoModulo,
} from '../../config/configuracao.service';

export interface DefinirEspecialistaDto {
  documentoId: string | null;
}

export interface MoverDocumentosDto {
  documentos: string[];
  moduloId: string | null;
}

function objeto(corpo: unknown): Record<string, unknown> {
  if (typeof corpo !== 'object' || corpo === null || Array.isArray(corpo)) {
    throw new BadRequestException('corpo da requisição inválido');
  }

  return corpo as Record<string, unknown>;
}

function textoObrigatorio(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || valor.trim().length === 0) {
    throw new BadRequestException(
      `"${campo}" é obrigatório e precisa ser texto`,
    );
  }

  return valor.trim();
}

function textoOpcional(valor: unknown, campo: string): string | undefined {
  if (valor === undefined) {
    return undefined;
  }

  if (typeof valor !== 'string') {
    throw new BadRequestException(`"${campo}" precisa ser texto`);
  }

  return valor.trim();
}

function identificadorOuNulo(valor: unknown, campo: string): string | null {
  if (valor === undefined || valor === null) {
    return null;
  }

  if (typeof valor !== 'string') {
    throw new BadRequestException(`"${campo}" precisa ser texto ou nulo`);
  }

  return valor.trim() || null;
}

export function validarNovoModuloDto(corpo: unknown): NovoModulo {
  const { nome, descricao } = objeto(corpo);

  return {
    nome: textoObrigatorio(nome, 'nome'),
    descricao: textoObrigatorio(descricao, 'descricao'),
  };
}

export function validarEdicaoDeModuloDto(corpo: unknown): EdicaoDeModulo {
  const { nome, descricao } = objeto(corpo);

  const edicao: EdicaoDeModulo = {
    ...(nome === undefined ? {} : { nome: textoOpcional(nome, 'nome') ?? '' }),
    ...(descricao === undefined
      ? {}
      : { descricao: textoOpcional(descricao, 'descricao') ?? '' }),
  };

  if (edicao.nome === undefined && edicao.descricao === undefined) {
    throw new BadRequestException(
      'informe "nome" ou "descricao" para atualizar o módulo',
    );
  }

  return edicao;
}

export function validarDefinirEspecialistaDto(
  corpo: unknown,
): DefinirEspecialistaDto {
  const { documentoId } = objeto(corpo);

  return { documentoId: identificadorOuNulo(documentoId, 'documentoId') };
}

export function validarMoverDocumentosDto(corpo: unknown): MoverDocumentosDto {
  const { documentos, moduloId } = objeto(corpo);

  if (
    !Array.isArray(documentos) ||
    documentos.some((item) => typeof item !== 'string')
  ) {
    throw new BadRequestException(
      '"documentos" precisa ser uma lista de identificadores de documento',
    );
  }

  return {
    documentos: (documentos as string[])
      .map((item) => item.trim())
      .filter(Boolean),
    moduloId: identificadorOuNulo(moduloId, 'moduloId'),
  };
}
