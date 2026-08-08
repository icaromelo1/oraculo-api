import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Repository } from 'typeorm';
import { Usuario } from '../database/entities';
import { ExigePerfil, PERFIL_DONO } from './exige-perfil.decorator';
import { ACAO_ADMINISTRATIVA_RESTRITA, PerfilGuard } from './perfil.guard';

class ControladorDeTeste {
  @ExigePerfil(PERFIL_DONO)
  administrativo(): boolean {
    return true;
  }

  @ExigePerfil()
  semPerfilNenhum(): boolean {
    return true;
  }

  @ExigePerfil(PERFIL_DONO)
  outraAcaoAdministrativa(): boolean {
    return true;
  }

  livre(): boolean {
    return true;
  }
}

type Metodo = keyof ControladorDeTeste;

function contextoDe(metodo: Metodo, requisicao: unknown): ExecutionContext {
  const handler = (ControladorDeTeste.prototype as Record<string, unknown>)[
    metodo
  ];

  return {
    getHandler: () => handler,
    getClass: () => ControladorDeTeste,
    switchToHttp: () => ({ getRequest: () => requisicao }),
  } as unknown as ExecutionContext;
}

function montar() {
  const usuarios = { findOne: jest.fn() };
  const guard = new PerfilGuard(
    new Reflector(),
    usuarios as unknown as Repository<Usuario>,
  );

  return { guard, usuarios };
}

const REQUISICAO_DO_DONO = {
  usuario: {
    id: 'usuario-1',
    login: 'icaro',
    perfil: { id: 'perfil-1', nome: PERFIL_DONO },
  },
};

async function motivoDaNegacao(
  promessa: Promise<unknown>,
): Promise<{ mensagem: string; status: number }> {
  try {
    await promessa;
  } catch (erro) {
    const forbidden = erro as ForbiddenException;

    return { mensagem: forbidden.message, status: forbidden.getStatus() };
  }

  throw new Error('esperava uma negação, mas o guard liberou');
}

describe('PerfilGuard', () => {
  it('libera a rota sem exigência de perfil sem sequer olhar o usuário', async () => {
    const { guard, usuarios } = montar();

    await expect(guard.canActivate(contextoDe('livre', {}))).resolves.toBe(
      true,
    );
    expect(usuarios.findOne).not.toHaveBeenCalled();
  });

  it('libera o perfil dono lendo o perfil que já veio no token', async () => {
    const { guard, usuarios } = montar();

    await expect(
      guard.canActivate(contextoDe('administrativo', REQUISICAO_DO_DONO)),
    ).resolves.toBe(true);
    expect(usuarios.findOne).not.toHaveBeenCalled();
  });

  it('nega outro perfil com 403 e motivo legível', async () => {
    const { guard } = montar();

    const negacao = await motivoDaNegacao(
      guard.canActivate(
        contextoDe('administrativo', {
          usuario: {
            id: 'usuario-2',
            login: 'convidado',
            perfil: { id: 'perfil-2', nome: 'leitor' },
          },
        }),
      ),
    );

    expect(negacao.status).toBe(403);
    expect(negacao.mensagem).toBe(ACAO_ADMINISTRATIVA_RESTRITA);
  });

  it('nega quando a requisição não tem usuário nenhum', async () => {
    const { guard } = montar();

    await expect(
      guard.canActivate(contextoDe('administrativo', {})),
    ).rejects.toThrow(ForbiddenException);
  });

  it('nega quando não há perfil no token nem id para resolver no banco', async () => {
    const { guard, usuarios } = montar();

    await expect(
      guard.canActivate(
        contextoDe('administrativo', { usuario: { login: 'icaro' } }),
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(usuarios.findOne).not.toHaveBeenCalled();
  });

  it('nega quando o nome do perfil no token é só espaço em branco', async () => {
    const { guard, usuarios } = montar();
    usuarios.findOne.mockResolvedValue(null);

    await expect(
      guard.canActivate(
        contextoDe('administrativo', {
          usuario: { id: 'usuario-1', perfil: { id: 'perfil-1', nome: '   ' } },
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('nega quando a exigência existe mas não lista perfil nenhum', async () => {
    const { guard } = montar();

    await expect(
      guard.canActivate(contextoDe('semPerfilNenhum', REQUISICAO_DO_DONO)),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('PerfilGuard — resolução pelo banco quando o token não carrega o perfil', () => {
  const REQUISICAO_SEM_PERFIL = { usuario: { id: 'usuario-1' } };

  it('libera quando o banco diz que o usuário ativo é dono', async () => {
    const { guard, usuarios } = montar();
    usuarios.findOne.mockResolvedValue({
      id: 'usuario-1',
      ativo: true,
      perfil: { id: 'perfil-1', nome: PERFIL_DONO },
    });

    await expect(
      guard.canActivate(contextoDe('administrativo', REQUISICAO_SEM_PERFIL)),
    ).resolves.toBe(true);
    expect(usuarios.findOne).toHaveBeenCalledWith({
      where: { id: 'usuario-1' },
      relations: { perfil: true },
    });
  });

  it('nega quando o banco diz que o perfil é outro', async () => {
    const { guard, usuarios } = montar();
    usuarios.findOne.mockResolvedValue({
      id: 'usuario-1',
      ativo: true,
      perfil: { id: 'perfil-2', nome: 'leitor' },
    });

    await expect(
      guard.canActivate(contextoDe('administrativo', REQUISICAO_SEM_PERFIL)),
    ).rejects.toThrow(ForbiddenException);
  });

  it('nega o usuário desativado mesmo que o perfil dele seja dono', async () => {
    const { guard, usuarios } = montar();
    usuarios.findOne.mockResolvedValue({
      id: 'usuario-1',
      ativo: false,
      perfil: { id: 'perfil-1', nome: PERFIL_DONO },
    });

    await expect(
      guard.canActivate(contextoDe('administrativo', REQUISICAO_SEM_PERFIL)),
    ).rejects.toThrow(ForbiddenException);
  });

  it('nega quando o usuário do token não existe mais no banco', async () => {
    const { guard, usuarios } = montar();
    usuarios.findOne.mockResolvedValue(null);

    await expect(
      guard.canActivate(contextoDe('administrativo', REQUISICAO_SEM_PERFIL)),
    ).rejects.toThrow(ForbiddenException);
  });

  it('nega quando o banco está fora — na dúvida, nega', async () => {
    const { guard, usuarios } = montar();
    usuarios.findOne.mockRejectedValue(new Error('banco fora do ar'));

    const negacao = await motivoDaNegacao(
      guard.canActivate(contextoDe('administrativo', REQUISICAO_SEM_PERFIL)),
    );

    expect(negacao.status).toBe(403);
    expect(negacao.mensagem).toBe(ACAO_ADMINISTRATIVA_RESTRITA);
  });
});

describe('PerfilGuard — a negação não descreve o recurso', () => {
  const REQUISICAO_DE_OUTRO_PERFIL = {
    usuario: {
      id: 'usuario-2',
      login: 'convidado',
      perfil: { id: 'perfil-2', nome: 'leitor' },
    },
    params: { id: 'proposta-secreta-42' },
    url: '/propostas/proposta-secreta-42/aprovar',
  };

  it('devolve a mesma mensagem para ações administrativas diferentes', async () => {
    const { guard } = montar();

    const primeira = await motivoDaNegacao(
      guard.canActivate(
        contextoDe('administrativo', REQUISICAO_DE_OUTRO_PERFIL),
      ),
    );
    const segunda = await motivoDaNegacao(
      guard.canActivate(
        contextoDe('outraAcaoAdministrativa', REQUISICAO_DE_OUTRO_PERFIL),
      ),
    );

    expect(primeira.mensagem).toBe(segunda.mensagem);
  });

  it('não cita id, rota, perfil exigido nem nome do recurso', async () => {
    const { guard } = montar();

    const negacao = await motivoDaNegacao(
      guard.canActivate(
        contextoDe('administrativo', REQUISICAO_DE_OUTRO_PERFIL),
      ),
    );

    for (const vazamento of [
      'proposta-secreta-42',
      'propostas',
      'aprovar',
      'persona',
      'provedor',
      'modulo',
      'alvo',
      'capacidade',
      PERFIL_DONO,
      'leitor',
    ]) {
      expect(negacao.mensagem.toLowerCase()).not.toContain(vazamento);
    }
  });
});
