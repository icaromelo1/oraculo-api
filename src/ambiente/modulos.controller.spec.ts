import { BadRequestException } from '@nestjs/common';
import type { RequisicaoAutenticada } from '../auth/requisicao-autenticada';
import {
  ConfiguracaoService,
  type ModuloResumido,
} from '../config/configuracao.service';
import { ModulosController } from './modulos.controller';

const REQUISICAO = {
  usuario: { id: 'usuario-1' },
} as unknown as RequisicaoAutenticada;

const MODULO: ModuloResumido = {
  id: 'modulo-1',
  nome: 'infra',
  descricao: 'servidores e deploy',
  especialistaDocumentoId: null,
  documentos: 3,
  criadoEm: new Date('2026-01-01T00:00:00Z'),
};

function montar() {
  const configuracao = {
    modulos: jest.fn().mockResolvedValue([MODULO]),
    mapaDeModulos: jest.fn().mockResolvedValue('- infra: servidores e deploy'),
    criarModulo: jest.fn().mockResolvedValue(MODULO),
    atualizarModulo: jest.fn().mockResolvedValue(MODULO),
    removerModulo: jest.fn().mockResolvedValue(undefined),
    definirEspecialista: jest.fn().mockResolvedValue(MODULO),
    moverDocumentos: jest
      .fn()
      .mockResolvedValue({ movidos: 2, moduloId: 'modulo-1' }),
  };

  return {
    controlador: new ModulosController(
      configuracao as unknown as ConfiguracaoService,
    ),
    configuracao,
  };
}

describe('ModulosController', () => {
  it('lista os módulos junto com o mapa compacto', async () => {
    const { controlador } = montar();

    expect(await controlador.listar()).toEqual({
      modulos: [MODULO],
      mapa: '- infra: servidores e deploy',
    });
  });

  it('cria módulo passando quem pediu', async () => {
    const { controlador, configuracao } = montar();

    await controlador.criar(
      { nome: ' infra ', descricao: ' servidores e deploy ' },
      REQUISICAO,
    );

    expect(configuracao.criarModulo).toHaveBeenCalledWith(
      { nome: 'infra', descricao: 'servidores e deploy' },
      'usuario-1',
    );
  });

  it('recusa criar módulo sem descrição antes de chegar no serviço', () => {
    const { controlador, configuracao } = montar();

    expect(() => controlador.criar({ nome: 'infra' }, REQUISICAO)).toThrow(
      BadRequestException,
    );
    expect(configuracao.criarModulo).not.toHaveBeenCalled();
  });

  it('recusa atualização vazia', () => {
    const { controlador } = montar();

    expect(() => controlador.atualizar('modulo-1', {}, REQUISICAO)).toThrow(
      /nome.*descricao/,
    );
  });

  it('move documentos aceitando módulo nulo', async () => {
    const { controlador, configuracao } = montar();

    await controlador.mover(
      { documentos: ['doc-1', ' doc-2 '], moduloId: null },
      REQUISICAO,
    );

    expect(configuracao.moverDocumentos).toHaveBeenCalledWith(
      ['doc-1', 'doc-2'],
      null,
      'usuario-1',
    );
  });

  it('recusa lista de documentos que não é lista de texto', () => {
    const { controlador } = montar();

    expect(() =>
      controlador.mover({ documentos: 'doc-1' }, REQUISICAO),
    ).toThrow(BadRequestException);
  });

  it('define o documento-capa e aceita limpar com nulo', async () => {
    const { controlador, configuracao } = montar();

    await controlador.definirEspecialista(
      'modulo-1',
      { documentoId: 'doc-1' },
      REQUISICAO,
    );
    await controlador.definirEspecialista('modulo-1', {}, REQUISICAO);

    expect(configuracao.definirEspecialista).toHaveBeenNthCalledWith(
      1,
      'modulo-1',
      'doc-1',
      'usuario-1',
    );
    expect(configuracao.definirEspecialista).toHaveBeenNthCalledWith(
      2,
      'modulo-1',
      null,
      'usuario-1',
    );
  });

  it('remove o módulo', async () => {
    const { controlador, configuracao } = montar();

    await controlador.remover('modulo-1', REQUISICAO);

    expect(configuracao.removerModulo).toHaveBeenCalledWith(
      'modulo-1',
      'usuario-1',
    );
  });
});
