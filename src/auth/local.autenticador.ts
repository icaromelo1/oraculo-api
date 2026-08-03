import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Repository } from 'typeorm';
import { Usuario } from '../database/entities';
import {
  Autenticador,
  SessaoAutenticada,
  UsuarioAutenticado,
} from './autenticador';

export interface PayloadToken {
  sub: string;
  login: string;
  perfil: {
    id: string;
    nome: string;
  };
}

const CREDENCIAIS_INVALIDAS = 'login ou senha inválidos';

@Injectable()
export class LocalAutenticador implements Autenticador {
  constructor(
    @InjectRepository(Usuario)
    private readonly usuarios: Repository<Usuario>,
    private readonly jwt: JwtService,
  ) {}

  async autenticar(login: string, senha: string): Promise<SessaoAutenticada> {
    const usuario = await this.usuarios.findOne({
      where: { login },
      relations: { perfil: true },
    });

    if (!usuario || !usuario.ativo) {
      throw new UnauthorizedException(CREDENCIAIS_INVALIDAS);
    }

    const senhaValida = await argon2.verify(usuario.senhaHash, senha);

    if (!senhaValida) {
      throw new UnauthorizedException(CREDENCIAIS_INVALIDAS);
    }

    const usuarioAutenticado = this.paraUsuarioAutenticado(usuario);
    const token = await this.assinar(usuarioAutenticado);

    return { token, usuario: usuarioAutenticado };
  }

  async usuarioDoToken(token: string): Promise<UsuarioAutenticado> {
    const payload = await this.jwt.verifyAsync<PayloadToken>(token);

    return {
      id: payload.sub,
      login: payload.login,
      perfil: payload.perfil,
    };
  }

  private assinar(usuario: UsuarioAutenticado): Promise<string> {
    const payload: PayloadToken = {
      sub: usuario.id,
      login: usuario.login,
      perfil: usuario.perfil,
    };

    return this.jwt.signAsync(payload);
  }

  private paraUsuarioAutenticado(usuario: Usuario): UsuarioAutenticado {
    return {
      id: usuario.id,
      login: usuario.login,
      perfil: {
        id: usuario.perfil.id,
        nome: usuario.perfil.nome,
      },
    };
  }
}
