import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Repository } from 'typeorm';
import { AmbienteController } from '../ambiente/ambiente.controller';
import { DiagnosticoController } from '../ambiente/diagnostico.controller';
import { ModulosController } from '../ambiente/modulos.controller';
import { PersonaController } from '../ambiente/persona.controller';
import { ProvedoresController } from '../ambiente/provedores.controller';
import { ChatController } from '../chat/chat.controller';
import { ConversasController } from '../chat/conversas.controller';
import { Usuario } from '../database/entities';
import { PropostasController } from '../propostas/propostas.controller';
import { AuthController } from './auth.controller';
import { PERFIL_DONO } from './exige-perfil.decorator';
import {
  ACAO_ADMINISTRATIVA_RESTRITA,
  PERFIS_EXIGIDOS_KEY,
  PerfilGuard,
} from './perfil.guard';

type Controlador = new (...args: any[]) => object;

interface Rota {
  descricao: string;
  classe: Controlador;
  metodo: string;
}

const ADMINISTRATIVAS: Rota[] = [
  {
    descricao: 'POST /propostas/:id/aprovar',
    classe: PropostasController,
    metodo: 'aprovar',
  },
  {
    descricao: 'POST /propostas/:id/descartar',
    classe: PropostasController,
    metodo: 'descartar',
  },
  {
    descricao: 'PUT /ambiente/persona',
    classe: PersonaController,
    metodo: 'definir',
  },
  {
    descricao: 'PATCH /ambiente/capacidades',
    classe: AmbienteController,
    metodo: 'definirCapacidade',
  },
  {
    descricao: 'POST /ambiente/fontes',
    classe: AmbienteController,
    metodo: 'criarFonte',
  },
  {
    descricao: 'DELETE /ambiente/fontes/:id',
    classe: AmbienteController,
    metodo: 'removerFonte',
  },
  {
    descricao: 'POST /ambiente/servicos',
    classe: AmbienteController,
    metodo: 'criarServico',
  },
  {
    descricao: 'DELETE /ambiente/servicos/:id',
    classe: AmbienteController,
    metodo: 'removerServico',
  },
  {
    descricao: 'POST /ambiente/alvos-banco',
    classe: AmbienteController,
    metodo: 'criarAlvoBanco',
  },
  {
    descricao: 'DELETE /ambiente/alvos-banco/:id',
    classe: AmbienteController,
    metodo: 'removerAlvoBanco',
  },
  {
    descricao: 'POST /ambiente/modulos',
    classe: ModulosController,
    metodo: 'criar',
  },
  {
    descricao: 'POST /ambiente/modulos/mover',
    classe: ModulosController,
    metodo: 'mover',
  },
  {
    descricao: 'PATCH /ambiente/modulos/:id',
    classe: ModulosController,
    metodo: 'atualizar',
  },
  {
    descricao: 'DELETE /ambiente/modulos/:id',
    classe: ModulosController,
    metodo: 'remover',
  },
  {
    descricao: 'POST /ambiente/modulos/:id/especialista',
    classe: ModulosController,
    metodo: 'definirEspecialista',
  },
  {
    descricao: 'POST /ambiente/provedores',
    classe: ProvedoresController,
    metodo: 'criar',
  },
  {
    descricao: 'POST /ambiente/provedores/testar',
    classe: ProvedoresController,
    metodo: 'testarAvulso',
  },
  {
    descricao: 'POST /ambiente/provedores/:id/ativar',
    classe: ProvedoresController,
    metodo: 'ativar',
  },
  {
    descricao: 'POST /ambiente/provedores/:id/testar',
    classe: ProvedoresController,
    metodo: 'testarCadastrado',
  },
  {
    descricao: 'DELETE /ambiente/provedores/:id',
    classe: ProvedoresController,
    metodo: 'remover',
  },
];

const LIVRES: Rota[] = [
  { descricao: 'POST /chat', classe: ChatController, metodo: 'responder' },
  {
    descricao: 'GET /conversas',
    classe: ConversasController,
    metodo: 'listar',
  },
  {
    descricao: 'GET /conversas/:id',
    classe: ConversasController,
    metodo: 'obter',
  },
  { descricao: 'GET /ambiente', classe: AmbienteController, metodo: 'estado' },
  {
    descricao: 'GET /ambiente/fontes/previa',
    classe: AmbienteController,
    metodo: 'previaDeFonte',
  },
  {
    descricao: 'GET /ambiente/persona',
    classe: PersonaController,
    metodo: 'ler',
  },
  {
    descricao: 'GET /ambiente/modulos',
    classe: ModulosController,
    metodo: 'listar',
  },
  {
    descricao: 'GET /ambiente/provedores',
    classe: ProvedoresController,
    metodo: 'listar',
  },
  {
    descricao: 'GET /ambiente/provedores/presets',
    classe: ProvedoresController,
    metodo: 'presets',
  },
  {
    descricao: 'GET /ambiente/diagnostico/catalogo',
    classe: DiagnosticoController,
    metodo: 'catalogo',
  },
  {
    descricao: 'GET /propostas',
    classe: PropostasController,
    metodo: 'listar',
  },
  {
    descricao: 'POST /propostas',
    classe: PropostasController,
    metodo: 'criar',
  },
  { descricao: 'POST /auth/entrar', classe: AuthController, metodo: 'entrar' },
  { descricao: 'GET /auth/eu', classe: AuthController, metodo: 'eu' },
];

function contextoDe(rota: Rota, requisicao: unknown): ExecutionContext {
  const handler = (rota.classe.prototype as Record<string, unknown>)[
    rota.metodo
  ];

  return {
    getHandler: () => handler,
    getClass: () => rota.classe,
    switchToHttp: () => ({ getRequest: () => requisicao }),
  } as unknown as ExecutionContext;
}

function montarGuard() {
  const usuarios = { findOne: jest.fn() };

  return {
    guard: new PerfilGuard(
      new Reflector(),
      usuarios as unknown as Repository<Usuario>,
    ),
    usuarios,
  };
}

const DONO = {
  usuario: {
    id: 'usuario-1',
    login: 'icaro',
    perfil: { id: 'perfil-1', nome: PERFIL_DONO },
  },
};

const OUTRO_PERFIL = {
  usuario: {
    id: 'usuario-2',
    login: 'convidado',
    perfil: { id: 'perfil-2', nome: 'leitor' },
  },
};

const SEM_PERFIL_DETERMINAVEL = { usuario: { login: 'fantasma' } };

describe('autorização administrativa — o dono continua fazendo tudo', () => {
  it.each(ADMINISTRATIVAS)('$descricao libera o perfil dono', async (rota) => {
    const { guard } = montarGuard();

    await expect(guard.canActivate(contextoDe(rota, DONO))).resolves.toBe(true);
  });

  it.each(ADMINISTRATIVAS)('$descricao exige o perfil dono', (rota) => {
    const handler = (rota.classe.prototype as Record<string, unknown>)[
      rota.metodo
    ];

    expect(Reflect.getMetadata(PERFIS_EXIGIDOS_KEY, handler as object)).toEqual(
      [PERFIL_DONO],
    );
  });
});

describe('autorização administrativa — outro perfil é barrado', () => {
  it.each(ADMINISTRATIVAS)('$descricao nega o perfil leitor', async (rota) => {
    const { guard } = montarGuard();

    await expect(
      guard.canActivate(contextoDe(rota, OUTRO_PERFIL)),
    ).rejects.toThrow(ACAO_ADMINISTRATIVA_RESTRITA);
  });

  it.each(ADMINISTRATIVAS)(
    '$descricao nega quem não tem perfil determinável',
    async (rota) => {
      const { guard } = montarGuard();

      await expect(
        guard.canActivate(contextoDe(rota, SEM_PERFIL_DETERMINAVEL)),
      ).rejects.toThrow(ForbiddenException);
    },
  );
});

describe('leitura e chat seguem abertos a qualquer autenticado', () => {
  it.each(LIVRES)('$descricao não exige perfil', (rota) => {
    const handler = (rota.classe.prototype as Record<string, unknown>)[
      rota.metodo
    ];

    expect(
      Reflect.getMetadata(PERFIS_EXIGIDOS_KEY, handler as object),
    ).toBeUndefined();
  });

  it.each(LIVRES)('$descricao passa com perfil não-dono', async (rota) => {
    const { guard } = montarGuard();

    await expect(
      guard.canActivate(contextoDe(rota, OUTRO_PERFIL)),
    ).resolves.toBe(true);
  });
});
