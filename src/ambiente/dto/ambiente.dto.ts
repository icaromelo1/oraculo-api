import { BadRequestException } from '@nestjs/common';
import type {
  NovaFonte,
  NovoAlvoBanco,
  NovoServico,
} from '../../config/configuracao.service';

export interface DefinirCapacidadeDto {
  capacidade: string;
  ligada: boolean;
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

function listaDeTexto(valor: unknown, campo: string): string[] {
  if (valor === undefined || valor === null) {
    return [];
  }

  if (!Array.isArray(valor) || valor.some((item) => typeof item !== 'string')) {
    throw new BadRequestException(`"${campo}" precisa ser uma lista de texto`);
  }

  return (valor as string[]).map((item) => item.trim()).filter(Boolean);
}

export function validarDefinirCapacidadeDto(
  corpo: unknown,
): DefinirCapacidadeDto {
  const { capacidade, ligada } = objeto(corpo);

  if (typeof ligada !== 'boolean') {
    throw new BadRequestException('"ligada" precisa ser booleano');
  }

  return {
    capacidade: textoObrigatorio(capacidade, 'capacidade'),
    ligada,
  };
}

export function validarNovaFonteDto(corpo: unknown): NovaFonte {
  const { caminho, rotulo } = objeto(corpo);

  return {
    caminho: textoObrigatorio(caminho, 'caminho'),
    ...(typeof rotulo === 'string' && rotulo.trim()
      ? { rotulo: rotulo.trim() }
      : {}),
  };
}

export function validarNovoServicoDto(corpo: unknown): NovoServico {
  const { nome, rotulo } = objeto(corpo);

  return {
    nome: textoObrigatorio(nome, 'nome'),
    rotulo: textoObrigatorio(rotulo, 'rotulo'),
  };
}

export function validarNovoAlvoBancoDto(corpo: unknown): NovoAlvoBanco {
  const { nome, url, schemas, colunasMascaradas } = objeto(corpo);

  return {
    nome: textoObrigatorio(nome, 'nome'),
    url: textoObrigatorio(url, 'url'),
    schemas: listaDeTexto(schemas, 'schemas'),
    colunasMascaradas: listaDeTexto(colunasMascaradas, 'colunasMascaradas'),
  };
}
