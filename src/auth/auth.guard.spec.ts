import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { Autenticador, UsuarioAutenticado } from './autenticador';

describe('AuthGuard', () => {
  let reflector: jest.Mocked<Reflector>;
  let autenticador: jest.Mocked<Autenticador>;
  let guard: AuthGuard;

  const usuario: UsuarioAutenticado = {
    id: 'usuario-1',
    login: 'icaro',
    perfil: { id: 'perfil-1', nome: 'dono' },
  };

  const criarContexto = (headers: Record<string, string> = {}) => {
    const requisicao: {
      headers: Record<string, string>;
      usuario?: UsuarioAutenticado;
    } = {
      headers,
    };

    return {
      getHandler: () => ({}) as unknown,
      getClass: () => ({}) as unknown,
      switchToHttp: () => ({
        getRequest: () => requisicao,
      }),
      requisicao,
    } as unknown as ExecutionContext & { requisicao: typeof requisicao };
  };

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;
    autenticador = {
      autenticar: jest.fn(),
      usuarioDoToken: jest.fn(),
    };
    guard = new AuthGuard(reflector, autenticador);
  });

  it('libera a rota marcada com @Publico() sem checar token', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const contexto = criarContexto();

    await expect(guard.canActivate(contexto)).resolves.toBe(true);
    expect(autenticador.usuarioDoToken).not.toHaveBeenCalled();
  });

  it('nega quando não há cabeçalho Authorization', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const contexto = criarContexto();

    await expect(guard.canActivate(contexto)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('nega quando o cabeçalho Authorization não é Bearer', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const contexto = criarContexto({ authorization: 'Basic algumacoisa' });

    await expect(guard.canActivate(contexto)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('nega quando o autenticador rejeita o token (inválido/adulterado)', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    autenticador.usuarioDoToken.mockRejectedValue(new Error('token inválido'));
    const contexto = criarContexto({ authorization: 'Bearer token-ruim' });

    await expect(guard.canActivate(contexto)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('libera e anexa o usuário à requisição quando o token é válido', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    autenticador.usuarioDoToken.mockResolvedValue(usuario);
    const contexto = criarContexto({ authorization: 'Bearer token-bom' });

    await expect(guard.canActivate(contexto)).resolves.toBe(true);
    expect(contexto.requisicao.usuario).toEqual(usuario);
  });
});
