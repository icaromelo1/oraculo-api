import { BadRequestException } from '@nestjs/common';
import type { RequisicaoAutenticada } from '../auth/requisicao-autenticada';
import { StatusProposta } from '../database/entities';
import { PropostasController } from './propostas.controller';
import { PropostasService, type PropostaResumida } from './propostas.service';

const REQUISICAO = {
  usuario: { id: 'usuario-1', login: 'icaro' },
} as unknown as RequisicaoAutenticada;

const PROPOSTA: PropostaResumida = {
  id: 'proposta-1',
  titulo: 'teto de sala no Kairos',
  conteudo: 'A sala tem teto de 40 pessoas.',
  justificativa: 'lendo o arquivo da sala',
  origemCaminho: 'kairos-api/src/sala.ts',
  moduloId: null,
  status: StatusProposta.PENDENTE,
  criadaEm: new Date('2026-08-01T10:00:00.000Z'),
  decididaEm: null,
  decididaPorId: null,
  observacaoDaDecisao: null,
  notaSlug: null,
};

function montar() {
  const propostas = {
    listar: jest.fn().mockResolvedValue([PROPOSTA]),
    criar: jest.fn().mockResolvedValue(PROPOSTA),
    aprovar: jest
      .fn()
      .mockResolvedValue({ proposta: PROPOSTA, nota: { slug: 'nota' } }),
    descartar: jest.fn().mockResolvedValue(PROPOSTA),
  };

  return {
    controlador: new PropostasController(
      propostas as unknown as PropostasService,
    ),
    propostas,
  };
}

describe('PropostasController', () => {
  it('lista sem filtro quando o status não vem', async () => {
    const { controlador, propostas } = montar();

    expect(await controlador.listar()).toEqual([PROPOSTA]);
    expect(propostas.listar).toHaveBeenCalledWith(undefined);
  });

  it('lista filtrando por status', async () => {
    const { controlador, propostas } = montar();

    await controlador.listar('descartada');

    expect(propostas.listar).toHaveBeenCalledWith(StatusProposta.DESCARTADA);
  });

  it('recusa status desconhecido', () => {
    const { controlador } = montar();

    expect(() => controlador.listar('arquivada')).toThrow(BadRequestException);
  });

  it('cria a proposta aparando os campos e passando quem pediu', async () => {
    const { controlador, propostas } = montar();

    await controlador.criar(
      {
        titulo: ' teto de sala ',
        conteudo: ' 40 pessoas ',
        justificativa: ' li o arquivo ',
        origemCaminho: ' kairos-api/src/sala.ts ',
      },
      REQUISICAO,
    );

    expect(propostas.criar).toHaveBeenCalledWith(
      {
        titulo: 'teto de sala',
        conteudo: '40 pessoas',
        justificativa: 'li o arquivo',
        origemCaminho: 'kairos-api/src/sala.ts',
        moduloId: null,
      },
      'usuario-1',
    );
  });

  it('exige justificativa na criação', () => {
    const { controlador } = montar();

    expect(() =>
      controlador.criar({ titulo: 'teto', conteudo: '40 pessoas' }, REQUISICAO),
    ).toThrow(BadRequestException);
  });

  it('aprova repassando a edição e quem decidiu', async () => {
    const { controlador, propostas } = montar();

    await controlador.aprovar(
      'proposta-1',
      { conteudo: ' redação nova ', moduloId: 'modulo-1' },
      REQUISICAO,
    );

    expect(propostas.aprovar).toHaveBeenCalledWith(
      'proposta-1',
      { conteudo: 'redação nova', moduloId: 'modulo-1' },
      { id: 'usuario-1', login: 'icaro' },
    );
  });

  it('aprova sem corpo nenhum', async () => {
    const { controlador, propostas } = montar();

    await controlador.aprovar('proposta-1', undefined, REQUISICAO);

    expect(propostas.aprovar).toHaveBeenCalledWith(
      'proposta-1',
      {},
      {
        id: 'usuario-1',
        login: 'icaro',
      },
    );
  });

  it('descarta repassando a observação', async () => {
    const { controlador, propostas } = montar();

    await controlador.descartar(
      'proposta-1',
      { observacao: ' já está no especialista ' },
      REQUISICAO,
    );

    expect(propostas.descartar).toHaveBeenCalledWith(
      'proposta-1',
      { observacao: 'já está no especialista' },
      { id: 'usuario-1', login: 'icaro' },
    );
  });
});
