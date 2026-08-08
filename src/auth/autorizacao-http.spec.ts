import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { PersonaController } from '../ambiente/persona.controller';
import { ConfiguracaoService } from '../config/configuracao.service';
import { Usuario } from '../database/entities';
import { PropostasController } from '../propostas/propostas.controller';
import { PropostasService } from '../propostas/propostas.service';
import { RedactionService } from '../security/redaction.service';
import { PERFIL_DONO } from './exige-perfil.decorator';
import { ACAO_ADMINISTRATIVA_RESTRITA, PerfilGuard } from './perfil.guard';

const DONO = {
  id: 'usuario-1',
  login: 'icaro',
  perfil: { id: 'perfil-1', nome: PERFIL_DONO },
};

const LEITOR = {
  id: 'usuario-2',
  login: 'convidado',
  perfil: { id: 'perfil-2', nome: 'leitor' },
};

describe('autorização administrativa sobre HTTP', () => {
  let app: INestApplication;
  let usuarioDaVez: unknown;
  const usuarios = { findOne: jest.fn() };
  const propostas = {
    listar: jest.fn().mockResolvedValue([]),
    criar: jest.fn().mockResolvedValue({ id: 'proposta-1' }),
    aprovar: jest.fn().mockResolvedValue({ proposta: { id: 'proposta-1' } }),
    descartar: jest.fn().mockResolvedValue({ id: 'proposta-1' }),
  };
  const configuracao = {
    persona: jest.fn().mockResolvedValue('persona atual'),
    definirPersona: jest.fn().mockResolvedValue('persona nova'),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PropostasController, PersonaController],
      providers: [
        PerfilGuard,
        RedactionService,
        { provide: getRepositoryToken(Usuario), useValue: usuarios },
        { provide: PropostasService, useValue: propostas },
        { provide: ConfiguracaoService, useValue: configuracao },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(
      (requisicao: Request, _resposta: Response, seguir: NextFunction) => {
        (requisicao as Request & { usuario: unknown }).usuario = usuarioDaVez;
        seguir();
      },
    );

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    usuarioDaVez = DONO;
    usuarios.findOne.mockReset();
  });

  const servidor = () => app.getHttpServer() as Parameters<typeof request>[0];

  describe('o dono continua fazendo tudo', () => {
    it('aprova proposta', async () => {
      await request(servidor()).post('/propostas/proposta-1/aprovar').send({});

      expect(propostas.aprovar).toHaveBeenCalled();
    });

    it('descarta proposta', async () => {
      await request(servidor())
        .post('/propostas/proposta-1/descartar')
        .send({})
        .expect(201);
    });

    it('edita a persona', async () => {
      await request(servidor())
        .put('/ambiente/persona')
        .send({ texto: 'nova persona' })
        .expect(200);

      expect(configuracao.definirPersona).toHaveBeenCalledWith(
        'nova persona',
        'usuario-1',
      );
    });
  });

  describe('outro perfil é barrado com 403 e motivo', () => {
    beforeEach(() => {
      usuarioDaVez = LEITOR;
    });

    it('não aprova proposta', async () => {
      const resposta = await request(servidor())
        .post('/propostas/proposta-1/aprovar')
        .send({})
        .expect(403);

      expect((resposta.body as { message: string }).message).toBe(
        ACAO_ADMINISTRATIVA_RESTRITA,
      );
    });

    it('não descarta proposta', async () => {
      await request(servidor())
        .post('/propostas/proposta-1/descartar')
        .send({})
        .expect(403);
    });

    it('não edita a persona', async () => {
      configuracao.definirPersona.mockClear();

      await request(servidor())
        .put('/ambiente/persona')
        .send({ texto: 'persona sequestrada' })
        .expect(403);

      expect(configuracao.definirPersona).not.toHaveBeenCalled();
    });
  });

  describe('requisição sem perfil determinável é negada', () => {
    it('nega quando não há usuário na requisição', async () => {
      usuarioDaVez = undefined;

      await request(servidor())
        .post('/propostas/proposta-1/aprovar')
        .send({})
        .expect(403);
    });

    it('nega quando o banco não confirma o perfil do usuário do token', async () => {
      usuarioDaVez = { id: 'usuario-3', login: 'sem-perfil' };
      usuarios.findOne.mockResolvedValue(null);

      await request(servidor())
        .put('/ambiente/persona')
        .send({ texto: 'persona sequestrada' })
        .expect(403);
    });
  });

  describe('leitura e criação de proposta seguem abertas', () => {
    beforeEach(() => {
      usuarioDaVez = LEITOR;
    });

    it('lista propostas', async () => {
      await request(servidor()).get('/propostas').expect(200);
    });

    it('lê a persona', async () => {
      await request(servidor()).get('/ambiente/persona').expect(200);
    });

    it('cria proposta — propor não é decidir', async () => {
      await request(servidor())
        .post('/propostas')
        .send({
          titulo: 'teto de sala',
          conteudo: '40 pessoas',
          justificativa: 'li o arquivo',
        })
        .expect(201);

      expect(propostas.criar).toHaveBeenCalled();
    });
  });
});
