import { BadRequestException } from '@nestjs/common';
import { StatusProposta } from '../../database/entities';
import type {
  DecisaoDeAprovacao,
  DecisaoDeDescarte,
  NovaProposta,
} from '../propostas.service';

const STATUS_VALIDOS: string[] = Object.values(StatusProposta);

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

  if (typeof valor !== 'string' || valor.trim().length === 0) {
    throw new BadRequestException(
      `"${campo}" precisa ser texto não vazio quando informado`,
    );
  }

  return valor.trim();
}

function textoOuNulo(valor: unknown, campo: string): string | null {
  if (valor === undefined || valor === null) {
    return null;
  }

  if (typeof valor !== 'string') {
    throw new BadRequestException(`"${campo}" precisa ser texto ou nulo`);
  }

  return valor.trim() || null;
}

export function validarNovaPropostaDto(corpo: unknown): NovaProposta {
  const { titulo, conteudo, justificativa, origemCaminho, moduloId } =
    objeto(corpo);

  return {
    titulo: textoObrigatorio(titulo, 'titulo'),
    conteudo: textoObrigatorio(conteudo, 'conteudo'),
    justificativa: textoObrigatorio(justificativa, 'justificativa'),
    origemCaminho: textoOuNulo(origemCaminho, 'origemCaminho'),
    moduloId: textoOuNulo(moduloId, 'moduloId'),
  };
}

export function validarAprovacaoDto(corpo: unknown): DecisaoDeAprovacao {
  if (corpo === undefined || corpo === null) {
    return {};
  }

  const { titulo, conteudo, moduloId, observacao } = objeto(corpo);

  return {
    ...(titulo === undefined
      ? {}
      : { titulo: textoOpcional(titulo, 'titulo') }),
    ...(conteudo === undefined
      ? {}
      : { conteudo: textoOpcional(conteudo, 'conteudo') }),
    ...(moduloId === undefined
      ? {}
      : { moduloId: textoOuNulo(moduloId, 'moduloId') }),
    ...(observacao === undefined
      ? {}
      : { observacao: textoOpcional(observacao, 'observacao') }),
  };
}

export function validarDescarteDto(corpo: unknown): DecisaoDeDescarte {
  if (corpo === undefined || corpo === null) {
    return {};
  }

  const { observacao } = objeto(corpo);

  return {
    ...(observacao === undefined
      ? {}
      : { observacao: textoOpcional(observacao, 'observacao') }),
  };
}

export function validarStatusDeProposta(
  valor: unknown,
): StatusProposta | undefined {
  if (valor === undefined || valor === null || valor === '') {
    return undefined;
  }

  if (typeof valor !== 'string' || !STATUS_VALIDOS.includes(valor)) {
    throw new BadRequestException(
      `"status" precisa ser um de: ${STATUS_VALIDOS.join(', ')}`,
    );
  }

  return valor as StatusProposta;
}
