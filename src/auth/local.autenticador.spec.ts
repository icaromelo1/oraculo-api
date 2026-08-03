import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Repository } from 'typeorm';
import { Usuario } from '../database/entities';
import { LocalAutenticador } from './local.autenticador';

describe('argon2 — hash e verificação de senha', () => {
  it('gera um hash argon2id verificável com a senha correta', async () => {
    const hash = await argon2.hash('minha-senha-forte', {
      type: argon2.argon2id,
    });

    expect(hash.startsWith('$argon2id$')).toBe(true);
    await expect(argon2.verify(hash, 'minha-senha-forte')).resolves.toBe(true);
  });

  it('rejeita a verificação com senha incorreta', async () => {
    const hash = await argon2.hash('minha-senha-forte', {
      type: argon2.argon2id,
    });

    await expect(argon2.verify(hash, 'senha-errada')).resolves.toBe(false);
  });
});

describe('LocalAutenticador', () => {
  let autenticador: LocalAutenticador;
  let usuarios: jest.Mocked<Pick<Repository<Usuario>, 'findOne'>>;
  let hashValido: string;

  const usuarioBase = {
    id: 'usuario-1',
    login: 'icaro',
    nome: 'Icaro',
    ativo: true,
    perfil: { id: 'perfil-1', nome: 'dono', descricao: null },
  };

  beforeAll(async () => {
    hashValido = await argon2.hash('senha-correta', {
      type: argon2.argon2id,
    });
  });

  beforeEach(async () => {
    usuarios = { findOne: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LocalAutenticador,
        {
          provide: getRepositoryToken(Usuario),
          useValue: usuarios,
        },
        {
          provide: JwtService,
          useValue: new JwtService({
            secret: 'segredo-de-teste-com-32-caracteres-ok',
            signOptions: { expiresIn: '1h' },
          }),
        },
      ],
    }).compile();

    autenticador = moduleRef.get(LocalAutenticador);
  });

  it('autentica com login e senha corretos e emite um token com o payload esperado', async () => {
    usuarios.findOne.mockResolvedValue({
      ...usuarioBase,
      senhaHash: hashValido,
    });

    const sessao = await autenticador.autenticar('icaro', 'senha-correta');

    expect(sessao.token).toEqual(expect.any(String));
    expect(sessao.usuario).toEqual({
      id: 'usuario-1',
      login: 'icaro',
      perfil: { id: 'perfil-1', nome: 'dono' },
    });

    const usuarioDoToken = await autenticador.usuarioDoToken(sessao.token);
    expect(usuarioDoToken).toEqual(sessao.usuario);
  });

  it('rejeita login inexistente', async () => {
    usuarios.findOne.mockResolvedValue(null);

    await expect(
      autenticador.autenticar('fantasma', 'qualquer'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejeita senha incorreta', async () => {
    usuarios.findOne.mockResolvedValue({
      ...usuarioBase,
      senhaHash: hashValido,
    });

    await expect(
      autenticador.autenticar('icaro', 'senha-errada'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejeita usuário inativo', async () => {
    usuarios.findOne.mockResolvedValue({
      ...usuarioBase,
      ativo: false,
      senhaHash: hashValido,
    });

    await expect(
      autenticador.autenticar('icaro', 'senha-correta'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejeita token expirado', async () => {
    const jwtCurto = new JwtService({
      secret: 'segredo-de-teste-com-32-caracteres-ok',
      signOptions: { expiresIn: '1ms' },
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        LocalAutenticador,
        { provide: getRepositoryToken(Usuario), useValue: usuarios },
        { provide: JwtService, useValue: jwtCurto },
      ],
    }).compile();

    const autenticadorComTokenCurto = moduleRef.get(LocalAutenticador);

    usuarios.findOne.mockResolvedValue({
      ...usuarioBase,
      senhaHash: hashValido,
    });

    const sessao = await autenticadorComTokenCurto.autenticar(
      'icaro',
      'senha-correta',
    );

    await new Promise((resolve) => setTimeout(resolve, 20));

    await expect(
      autenticadorComTokenCurto.usuarioDoToken(sessao.token),
    ).rejects.toThrow();
  });

  it('rejeita token adulterado', async () => {
    usuarios.findOne.mockResolvedValue({
      ...usuarioBase,
      senhaHash: hashValido,
    });

    const sessao = await autenticador.autenticar('icaro', 'senha-correta');
    const tokenAdulterado = `${sessao.token.slice(0, -3)}xxx`;

    await expect(
      autenticador.usuarioDoToken(tokenAdulterado),
    ).rejects.toThrow();
  });
});
