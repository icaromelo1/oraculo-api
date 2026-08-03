import { Request } from 'express';
import { UsuarioAutenticado } from './autenticador';

export interface RequisicaoAutenticada extends Request {
  usuario: UsuarioAutenticado;
}
