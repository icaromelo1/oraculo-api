import { BadRequestException } from '@nestjs/common';

export class EntrarDto {
  login: string;
  senha: string;
}

export function validarEntrarDto(corpo: unknown): EntrarDto {
  if (typeof corpo !== 'object' || corpo === null) {
    throw new BadRequestException('corpo da requisição inválido');
  }

  const { login, senha } = corpo as Record<string, unknown>;

  if (typeof login !== 'string' || login.trim().length === 0) {
    throw new BadRequestException('login é obrigatório');
  }

  if (typeof senha !== 'string' || senha.length === 0) {
    throw new BadRequestException('senha é obrigatória');
  }

  const dto = new EntrarDto();
  dto.login = login.trim();
  dto.senha = senha;

  return dto;
}
