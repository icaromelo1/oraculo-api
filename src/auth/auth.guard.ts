import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AUTENTICADOR } from './autenticador';
import type { Autenticador } from './autenticador';
import { PUBLICO_KEY } from './publico.decorator';
import type { RequisicaoAutenticada } from './requisicao-autenticada';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTENTICADOR) private readonly autenticador: Autenticador,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const publico = this.reflector.getAllAndOverride<boolean>(PUBLICO_KEY, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);

    if (publico) {
      return true;
    }

    const requisicao = contexto
      .switchToHttp()
      .getRequest<RequisicaoAutenticada>();
    const token = this.extrairToken(requisicao);

    if (!token) {
      throw new UnauthorizedException('token ausente');
    }

    try {
      requisicao.usuario = await this.autenticador.usuarioDoToken(token);
    } catch {
      throw new UnauthorizedException('token inválido');
    }

    return true;
  }

  private extrairToken(requisicao: RequisicaoAutenticada): string | undefined {
    const cabecalho = requisicao.headers.authorization;

    if (!cabecalho) {
      return undefined;
    }

    const [tipo, token] = cabecalho.split(' ');

    if (tipo !== 'Bearer' || !token) {
      return undefined;
    }

    return token;
  }
}
