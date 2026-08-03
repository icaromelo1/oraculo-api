import { Injectable } from '@nestjs/common';
import {
  Autenticador,
  SessaoAutenticada,
  UsuarioAutenticado,
} from './autenticador';

@Injectable()
export class KeycloakAutenticador implements Autenticador {
  autenticar(): Promise<SessaoAutenticada> {
    throw new Error('AUTH_MODE=keycloak ainda não implementado');
  }

  usuarioDoToken(): Promise<UsuarioAutenticado> {
    throw new Error('AUTH_MODE=keycloak ainda não implementado');
  }
}
