import { BadRequestException } from '@nestjs/common';
import type { NovoProvedor } from '../../config/configuracao.service';
import type { TipoProvedorModelo } from '../../database/entities';
import {
  aplicarPreset,
  type CadastroDeProvedor,
} from '../../providers/presets';

const NOME_DO_AVULSO = '(não cadastrado)';

function objeto(corpo: unknown): Record<string, unknown> {
  if (typeof corpo !== 'object' || corpo === null || Array.isArray(corpo)) {
    throw new BadRequestException('corpo da requisição inválido');
  }

  return corpo as Record<string, unknown>;
}

function texto(valor: unknown, campo: string): string | undefined {
  if (valor === undefined || valor === null) {
    return undefined;
  }

  if (typeof valor !== 'string') {
    throw new BadRequestException(`"${campo}" precisa ser texto`);
  }

  return valor.trim() || undefined;
}

function mapa(
  valor: unknown,
  campo: string,
): Record<string, unknown> | undefined {
  if (valor === undefined || valor === null) {
    return undefined;
  }

  if (typeof valor !== 'object' || Array.isArray(valor)) {
    throw new BadRequestException(`"${campo}" precisa ser um objeto`);
  }

  return valor as Record<string, unknown>;
}

function mapaDeTexto(
  valor: unknown,
  campo: string,
): Record<string, string> | undefined {
  const bruto = mapa(valor, campo);

  if (!bruto) {
    return undefined;
  }

  const entradas = Object.entries(bruto);

  if (entradas.some(([, item]) => typeof item !== 'string')) {
    throw new BadRequestException(`"${campo}" só aceita valores de texto`);
  }

  return Object.fromEntries(entradas) as Record<string, string>;
}

function comPreset(
  id: string,
  parcial: Partial<CadastroDeProvedor>,
): CadastroDeProvedor {
  try {
    return aplicarPreset(id, parcial);
  } catch (erro) {
    throw new BadRequestException(
      erro instanceof Error
        ? erro.message
        : `preset de provedor desconhecido: ${id}`,
    );
  }
}

function montar(corpo: unknown, exigirNome: boolean): NovoProvedor {
  const dados = objeto(corpo);

  const preset = texto(dados.preset, 'preset');
  const tipo = texto(dados.tipo, 'tipo');
  const nome = texto(dados.nome, 'nome');
  const baseUrl = texto(dados.baseUrl, 'baseUrl');
  const modelo = texto(dados.modelo, 'modelo');
  const chave = texto(dados.chave, 'chave');
  const comando = texto(dados.comando, 'comando');
  const dialeto = texto(dados.dialeto, 'dialeto');
  const cabecalhosExtras = mapaDeTexto(
    dados.cabecalhosExtras,
    'cabecalhosExtras',
  );
  const parametros = mapa(dados.parametros, 'parametros');

  if (exigirNome && !nome) {
    throw new BadRequestException('"nome" é obrigatório e precisa ser texto');
  }

  if (!preset && !tipo) {
    throw new BadRequestException(
      'informe "tipo" ou "preset" para identificar o provedor',
    );
  }

  const parcial: Partial<CadastroDeProvedor> = {
    ...(tipo ? { tipo: tipo as TipoProvedorModelo } : {}),
    ...(nome ? { nome } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(modelo ? { modelo } : {}),
    ...(chave ? { chave } : {}),
    ...(cabecalhosExtras ? { cabecalhosExtras } : {}),
    ...(parametros ? { parametros } : {}),
  };

  const cadastro = preset ? comPreset(preset, parcial) : parcial;

  return {
    nome: nome ?? NOME_DO_AVULSO,
    tipo: String(cadastro.tipo ?? tipo ?? ''),
    ...(cadastro.baseUrl ? { baseUrl: cadastro.baseUrl } : {}),
    ...(cadastro.modelo ? { modelo: cadastro.modelo } : {}),
    ...(cadastro.chave ? { chave: cadastro.chave } : {}),
    ...(cadastro.cabecalhosExtras
      ? { cabecalhosExtras: cadastro.cabecalhosExtras }
      : {}),
    ...(cadastro.parametros ? { parametros: cadastro.parametros } : {}),
    ...(comando ? { comando } : {}),
    ...(dialeto ? { dialeto } : {}),
  };
}

export function validarNovoProvedorDto(corpo: unknown): NovoProvedor {
  return montar(corpo, true);
}

export function validarTesteDeProvedorDto(corpo: unknown): NovoProvedor {
  return montar(corpo, false);
}
