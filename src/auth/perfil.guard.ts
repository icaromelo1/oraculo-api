import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Usuario } from '../database/entities';
import type { RequisicaoAutenticada } from './requisicao-autenticada';

export const PERFIS_EXIGIDOS_KEY = 'perfis-exigidos';

export const ACAO_ADMINISTRATIVA_RESTRITA =
  'ação administrativa restrita ao perfil responsável por esta instalação';

@Injectable()
export class PerfilGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(Usuario)
    private readonly usuarios: Repository<Usuario>,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const exigidos = this.reflector.getAllAndOverride<string[] | undefined>(
      PERFIS_EXIGIDOS_KEY,
      [contexto.getHandler(), contexto.getClass()],
    );

    if (exigidos === undefined) {
      return true;
    }

    if (!Array.isArray(exigidos) || exigidos.length === 0) {
      throw new ForbiddenException(ACAO_ADMINISTRATIVA_RESTRITA);
    }

    const requisicao = contexto
      .switchToHttp()
      .getRequest<RequisicaoAutenticada>();
    const perfil = await this.resolverPerfil(requisicao);

    if (perfil === null || !exigidos.includes(perfil)) {
      throw new ForbiddenException(ACAO_ADMINISTRATIVA_RESTRITA);
    }

    return true;
  }

  private async resolverPerfil(
    requisicao: RequisicaoAutenticada,
  ): Promise<string | null> {
    const doToken = this.nome(requisicao.usuario?.perfil?.nome);

    if (doToken !== null) {
      return doToken;
    }

    const usuarioId = requisicao.usuario?.id;

    if (typeof usuarioId !== 'string' || usuarioId.trim().length === 0) {
      return null;
    }

    try {
      const usuario = await this.usuarios.findOne({
        where: { id: usuarioId },
        relations: { perfil: true },
      });

      if (!usuario || !usuario.ativo) {
        return null;
      }

      return this.nome(usuario.perfil?.nome);
    } catch {
      return null;
    }
  }

  private nome(valor: unknown): string | null {
    if (typeof valor !== 'string' || valor.trim().length === 0) {
      return null;
    }

    return valor.trim();
  }
}
