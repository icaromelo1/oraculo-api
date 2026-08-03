export interface PerfilAutenticado {
  id: string;
  nome: string;
}

export interface UsuarioAutenticado {
  id: string;
  login: string;
  perfil: PerfilAutenticado;
}

export interface SessaoAutenticada {
  token: string;
  usuario: UsuarioAutenticado;
}

export interface Autenticador {
  autenticar: (login: string, senha: string) => Promise<SessaoAutenticada>;
  usuarioDoToken: (token: string) => Promise<UsuarioAutenticado>;
}

export const AUTENTICADOR = Symbol('AUTENTICADOR');
