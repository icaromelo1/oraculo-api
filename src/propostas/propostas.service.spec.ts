import { ConflictException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ConfiguracaoService } from '../config/configuracao.service';
import {
  ConhecimentoService,
  type NotaGravada,
} from '../conhecimento/conhecimento.service';
import type { CriarNotaDto } from '../conhecimento/dto/criar-nota.dto';
import { PropostaConhecimento, StatusProposta } from '../database/entities';
import { SecurityService } from '../security/security.service';
import type { RegistroTurno } from '../security/tipos';
import { TITULO_DA_PROCEDENCIA } from './procedencia-da-proposta';
import { PropostasService } from './propostas.service';

const DECISOR = { id: 'usuario-1', login: 'icaro' };

function proposta(
  parcial: Partial<PropostaConhecimento> = {},
): PropostaConhecimento {
  return {
    id: 'proposta-1',
    titulo: 'teto de sala no Kairos',
    conteudo: 'A sala do Kairos tem teto de 40 pessoas.',
    justificativa: 'descoberto ao ler o arquivo da sala',
    origemCaminho: 'kairos-api/src/sala.ts',
    moduloId: null,
    modulo: null,
    status: StatusProposta.PENDENTE,
    criadaEm: new Date('2026-08-01T10:00:00.000Z'),
    decididaEm: null,
    decididaPorId: null,
    decididaPor: null,
    observacaoDaDecisao: null,
    ...parcial,
  };
}

function criarRepositorio(inicial: PropostaConhecimento[] = []) {
  const linhas: PropostaConhecimento[] = [...inicial];
  let proximo = linhas.length + 1;

  const repositorio = {
    linhas,
    create: jest.fn((dados: Partial<PropostaConhecimento>) => ({ ...dados })),
    save: jest.fn((dados: Partial<PropostaConhecimento>) => {
      const salva = {
        ...dados,
        id: dados.id ?? `proposta-${proximo++}`,
        criadaEm: dados.criadaEm ?? new Date('2026-08-02T00:00:00.000Z'),
      } as PropostaConhecimento;

      const posicao = linhas.findIndex((linha) => linha.id === salva.id);

      if (posicao >= 0) {
        linhas[posicao] = salva;
      } else {
        linhas.push(salva);
      }

      return Promise.resolve(salva);
    }),
    findOne: jest.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve(linhas.find((linha) => linha.id === where.id) ?? null),
    ),
    find: jest.fn(({ where }: { where?: { status?: StatusProposta } } = {}) =>
      Promise.resolve(
        linhas
          .filter((linha) => !where?.status || linha.status === where.status)
          .sort(
            (um, outro) => outro.criadaEm.getTime() - um.criadaEm.getTime(),
          ),
      ),
    ),
  };

  return repositorio;
}

function montar(inicial: PropostaConhecimento[] = []) {
  const repositorio = criarRepositorio(inicial);

  const conhecimento = {
    criarNota: jest
      .fn<Promise<NotaGravada>, [CriarNotaDto, (string | null)?]>()
      .mockResolvedValue({
        id: 'documento-1',
        slug: 'teto-de-sala-no-kairos',
        caminho: '/notas/teto-de-sala-no-kairos.md',
        trechosIndexados: 2,
      }),
  };

  const configuracao = {
    modulos: jest.fn().mockResolvedValue([{ id: 'modulo-1', nome: 'kairos' }]),
    moverDocumentos: jest
      .fn()
      .mockResolvedValue({ movidos: 1, moduloId: 'modulo-1' }),
  };

  const seguranca = {
    registrar: jest
      .fn<Promise<null>, [RegistroTurno]>()
      .mockResolvedValue(null),
  };

  const servico = new PropostasService(
    repositorio as unknown as Repository<PropostaConhecimento>,
    conhecimento as unknown as ConhecimentoService,
    configuracao as unknown as ConfiguracaoService,
    seguranca as unknown as SecurityService,
  );

  return { servico, repositorio, conhecimento, configuracao, seguranca };
}

type Montagem = ReturnType<typeof montar>;

function auditorias(seguranca: Montagem['seguranca']): RegistroTurno[] {
  return seguranca.registrar.mock.calls.map(([registro]) => registro);
}

function acoesAuditadas(seguranca: Montagem['seguranca']): string[] {
  return auditorias(seguranca).map(
    (registro) => registro.ferramentas?.[0]?.nome ?? '(sem ferramenta)',
  );
}

describe('PropostasService', () => {
  describe('criar', () => {
    it('registra a proposta como pendente sem gravar nada no corpus', async () => {
      const { servico, conhecimento } = montar();

      const criada = await servico.criar(
        {
          titulo: 'teto de sala no Kairos',
          conteudo: 'A sala do Kairos tem teto de 40 pessoas.',
          justificativa: 'descoberto ao ler o arquivo da sala',
          origemCaminho: 'kairos-api/src/sala.ts',
          moduloId: null,
        },
        DECISOR.id,
      );

      expect(criada.status).toBe(StatusProposta.PENDENTE);
      expect(criada.decididaEm).toBeNull();
      expect(criada.origemCaminho).toBe('kairos-api/src/sala.ts');
      expect(conhecimento.criarNota).not.toHaveBeenCalled();
    });

    it('audita a criação', async () => {
      const { servico, seguranca } = montar();

      await servico.criar(
        {
          titulo: 'teto de sala no Kairos',
          conteudo: 'A sala tem teto de 40 pessoas.',
          justificativa: 'descoberto ao ler o arquivo da sala',
          origemCaminho: null,
          moduloId: null,
        },
        DECISOR.id,
      );

      expect(acoesAuditadas(seguranca)).toEqual([
        'conhecimento.proposta.criar',
      ]);
      expect(auditorias(seguranca)[0].usuarioId).toBe('usuario-1');
    });
  });

  describe('listar', () => {
    it('devolve as mais recentes primeiro', async () => {
      const { servico } = montar([
        proposta({ id: 'antiga', criadaEm: new Date('2026-01-01T00:00:00Z') }),
        proposta({ id: 'nova', criadaEm: new Date('2026-08-01T00:00:00Z') }),
      ]);

      expect((await servico.listar()).map((item) => item.id)).toEqual([
        'nova',
        'antiga',
      ]);
    });

    it('filtra por status quando pedido', async () => {
      const { servico, repositorio } = montar([
        proposta({ id: 'pendente-1' }),
        proposta({ id: 'aprovada-1', status: StatusProposta.APROVADA }),
      ]);

      const aprovadas = await servico.listar(StatusProposta.APROVADA);

      expect(aprovadas.map((item) => item.id)).toEqual(['aprovada-1']);
      expect(repositorio.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: StatusProposta.APROVADA },
          order: { criadaEm: 'DESC' },
        }),
      );
    });
  });

  describe('aprovar', () => {
    it('grava a nota pelo ConhecimentoService e marca a proposta como aprovada', async () => {
      const { servico, conhecimento } = montar([proposta()]);

      const resultado = await servico.aprovar('proposta-1', {}, DECISOR);

      expect(conhecimento.criarNota).toHaveBeenCalledTimes(1);
      expect(resultado.nota.caminho).toBe('/notas/teto-de-sala-no-kairos.md');
      expect(resultado.proposta.status).toBe(StatusProposta.APROVADA);
      expect(resultado.proposta.decididaPorId).toBe('usuario-1');
      expect(resultado.proposta.decididaEm).toBeInstanceOf(Date);
    });

    it('grava o conteúdo editado, não o original', async () => {
      const { servico, conhecimento, repositorio } = montar([proposta()]);

      await servico.aprovar(
        'proposta-1',
        {
          titulo: 'teto da sala do Kairos',
          conteudo: 'A sala do Kairos aceita no máximo 40 pessoas simultâneas.',
          observacao: 'ajustei a redação antes de aprovar',
        },
        DECISOR,
      );

      const [pedido, usuarioId] = conhecimento.criarNota.mock.calls[0];

      expect(usuarioId).toBe('usuario-1');
      expect(pedido.titulo).toBe('teto da sala do Kairos');
      expect(pedido.conteudo).toContain(
        'A sala do Kairos aceita no máximo 40 pessoas simultâneas.',
      );
      expect(pedido.conteudo).not.toContain(
        'A sala do Kairos tem teto de 40 pessoas.',
      );

      const guardada = repositorio.linhas[0];

      expect(guardada.titulo).toBe('teto da sala do Kairos');
      expect(guardada.conteudo).toBe(
        'A sala do Kairos aceita no máximo 40 pessoas simultâneas.',
      );
      expect(guardada.observacaoDaDecisao).toBe(
        'ajustei a redação antes de aprovar',
      );
    });

    it('carrega a procedência no conteúdo gravado', async () => {
      const { servico, conhecimento } = montar([proposta()]);

      await servico.aprovar('proposta-1', {}, DECISOR);

      const conteudo = conhecimento.criarNota.mock.calls[0][0].conteudo;

      expect(conteudo).toContain(TITULO_DA_PROCEDENCIA);
      expect(conteudo).toContain('proposta do Oráculo');
      expect(conteudo).toContain(
        '- Origem da descoberta: kairos-api/src/sala.ts',
      );
      expect(conteudo).toContain('- Descoberta em: 2026-08-01T10:00:00.000Z');
      expect(conteudo).toContain('- Aprovada por: icaro');
      expect(conteudo).toContain(
        '- Justificativa da proposta: descoberto ao ler o arquivo da sala',
      );
    });

    it('classifica a nota gravada no módulo escolhido na hora da aprovação', async () => {
      const { servico, configuracao } = montar([proposta()]);

      await servico.aprovar('proposta-1', { moduloId: 'modulo-1' }, DECISOR);

      expect(configuracao.moverDocumentos).toHaveBeenCalledWith(
        ['documento-1'],
        'modulo-1',
        'usuario-1',
      );
    });

    it('recusa módulo inexistente antes de gravar qualquer coisa', async () => {
      const { servico, conhecimento } = montar([proposta()]);

      await expect(
        servico.aprovar('proposta-1', { moduloId: 'modulo-fantasma' }, DECISOR),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(conhecimento.criarNota).not.toHaveBeenCalled();
    });

    it('audita a aprovação com o caminho da nota', async () => {
      const { servico, seguranca } = montar([proposta()]);

      await servico.aprovar('proposta-1', {}, DECISOR);

      expect(acoesAuditadas(seguranca)).toEqual([
        'conhecimento.proposta.aprovar',
      ]);
      expect(auditorias(seguranca)[0].resultado).toContain(
        '/notas/teto-de-sala-no-kairos.md',
      );
    });

    it('404 quando a proposta não existe', async () => {
      const { servico } = montar([]);

      await expect(
        servico.aprovar('proposta-9', {}, DECISOR),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('descartar', () => {
    it('marca como descartada sem tocar no corpus', async () => {
      const { servico, conhecimento } = montar([proposta()]);

      const descartada = await servico.descartar(
        'proposta-1',
        { observacao: 'isso já está no especialista' },
        DECISOR,
      );

      expect(descartada.status).toBe(StatusProposta.DESCARTADA);
      expect(descartada.observacaoDaDecisao).toBe(
        'isso já está no especialista',
      );
      expect(descartada.decididaPorId).toBe('usuario-1');
      expect(conhecimento.criarNota).not.toHaveBeenCalled();
    });

    it('audita o descarte', async () => {
      const { servico, seguranca } = montar([proposta()]);

      await servico.descartar('proposta-1', {}, DECISOR);

      expect(acoesAuditadas(seguranca)).toEqual([
        'conhecimento.proposta.descartar',
      ]);
    });
  });

  describe('decidir duas vezes', () => {
    it('409 ao aprovar proposta já aprovada', async () => {
      const { servico, conhecimento } = montar([proposta()]);

      await servico.aprovar('proposta-1', {}, DECISOR);
      conhecimento.criarNota.mockClear();

      await expect(
        servico.aprovar('proposta-1', {}, DECISOR),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(conhecimento.criarNota).not.toHaveBeenCalled();
    });

    it('409 ao descartar proposta já aprovada, dizendo o motivo', async () => {
      const { servico } = montar([proposta()]);

      await servico.aprovar('proposta-1', {}, DECISOR);

      await expect(
        servico.descartar('proposta-1', {}, DECISOR),
      ).rejects.toThrow(/já foi aprovada/);
    });

    it('409 ao aprovar proposta já descartada', async () => {
      const { servico } = montar([proposta()]);

      await servico.descartar('proposta-1', {}, DECISOR);

      await expect(servico.aprovar('proposta-1', {}, DECISOR)).rejects.toThrow(
        /já foi descartada/,
      );
    });
  });
});
