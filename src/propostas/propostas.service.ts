import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfiguracaoService } from '../config/configuracao.service';
import {
  ConhecimentoService,
  NotaGravada,
} from '../conhecimento/conhecimento.service';
import { PropostaConhecimento, StatusProposta } from '../database/entities';
import { SecurityService } from '../security/security.service';
import { corpoDaNota } from '../conhecimento/corpo-da-nota';
import { comProcedencia } from './procedencia-da-proposta';

export interface NovaProposta {
  titulo: string;
  conteudo: string;
  justificativa: string;
  origemCaminho: string | null;
  moduloId: string | null;
}

export interface DecisaoDeAprovacao {
  titulo?: string;
  conteudo?: string;
  moduloId?: string | null;
  observacao?: string;
}

export interface DecisaoDeDescarte {
  observacao?: string;
}

export interface Decisor {
  id: string | null;
  login: string | null;
}

export interface PropostaResumida {
  id: string;
  titulo: string;
  conteudo: string;
  justificativa: string;
  origemCaminho: string | null;
  moduloId: string | null;
  status: StatusProposta;
  criadaEm: Date;
  decididaEm: Date | null;
  decididaPorId: string | null;
  observacaoDaDecisao: string | null;
  notaSlug: string | null;
}

export interface PropostaAprovada {
  proposta: PropostaResumida;
  nota: NotaGravada;
}

const VERBO_DO_STATUS: Record<StatusProposta, string> = {
  [StatusProposta.PENDENTE]: 'continua pendente',
  [StatusProposta.APROVADA]: 'já foi aprovada',
  [StatusProposta.DESCARTADA]: 'já foi descartada',
};

@Injectable()
export class PropostasService {
  private readonly logger = new Logger(PropostasService.name);

  constructor(
    @InjectRepository(PropostaConhecimento)
    private readonly propostas: Repository<PropostaConhecimento>,
    private readonly conhecimento: ConhecimentoService,
    private readonly configuracao: ConfiguracaoService,
    private readonly seguranca: SecurityService,
  ) {}

  async listar(status?: StatusProposta): Promise<PropostaResumida[]> {
    const encontradas = await this.propostas.find({
      ...(status ? { where: { status } } : {}),
      order: { criadaEm: 'DESC' },
    });

    return encontradas.map((proposta) => this.resumir(proposta));
  }

  async criar(
    nova: NovaProposta,
    usuarioId?: string | null,
  ): Promise<PropostaResumida> {
    const salva = await this.propostas.save(
      this.propostas.create({
        titulo: nova.titulo,
        conteudo: nova.conteudo,
        justificativa: nova.justificativa,
        origemCaminho: nova.origemCaminho,
        moduloId: nova.moduloId,
        status: StatusProposta.PENDENTE,
        decididaEm: null,
        decididaPorId: null,
        observacaoDaDecisao: null,
        notaSlug: null,
      }),
    );

    await this.auditar(
      usuarioId,
      'conhecimento.proposta.criar',
      {
        id: salva.id,
        titulo: salva.titulo,
        origemCaminho: salva.origemCaminho,
        moduloId: salva.moduloId,
      },
      `proposta "${salva.titulo}" registrada como pendente — nada foi gravado no corpus até um humano aprovar`,
    );

    return this.resumir(salva);
  }

  async aprovar(
    id: string,
    decisao: DecisaoDeAprovacao,
    decisor?: Decisor | null,
  ): Promise<PropostaAprovada> {
    const proposta = await this.exigirPendente(id, 'aprovar');
    const usuarioId = decisor?.id ?? null;

    const titulo = decisao.titulo ?? proposta.titulo;
    const conteudo = decisao.conteudo ?? proposta.conteudo;
    const moduloId =
      decisao.moduloId === undefined ? proposta.moduloId : decisao.moduloId;

    await this.exigirModuloConhecido(moduloId);

    const decididaEm = new Date();

    const corpo = corpoDaNota(
      titulo,
      comProcedencia(conteudo, {
        origemCaminho: proposta.origemCaminho,
        justificativa: proposta.justificativa,
        descobertaEm: proposta.criadaEm,
        aprovadaEm: decididaEm,
        aprovadaPor: decisor?.login ?? null,
      }),
    );

    const { nota, regravada } = await this.notaDaProposta(
      proposta,
      titulo,
      corpo,
      usuarioId,
    );

    await this.classificarNoModulo(nota, moduloId, usuarioId);

    const aprovada = await this.propostas.save({
      ...proposta,
      titulo,
      conteudo,
      moduloId,
      notaSlug: nota.slug,
      status: StatusProposta.APROVADA,
      decididaEm,
      decididaPorId: usuarioId,
      observacaoDaDecisao: decisao.observacao ?? null,
    });

    await this.auditar(
      usuarioId,
      'conhecimento.proposta.aprovar',
      {
        id: proposta.id,
        titulo,
        slug: nota.slug,
        caminho: nota.caminho,
        moduloId,
        regravada,
        editada: titulo !== proposta.titulo || conteudo !== proposta.conteudo,
      },
      `proposta "${titulo}" aprovada (antes: pendente) e ${
        regravada
          ? 'regravada sobre a nota que ela já tinha reservado'
          : 'gravada como nota'
      } em ${nota.caminho} — ${nota.trechosIndexados} trecho(s) indexado(s)`,
    );

    return { proposta: this.resumir(aprovada), nota };
  }

  async descartar(
    id: string,
    decisao: DecisaoDeDescarte,
    decisor?: Decisor | null,
  ): Promise<PropostaResumida> {
    const proposta = await this.exigirPendente(id, 'descartar');
    const usuarioId = decisor?.id ?? null;

    const descartada = await this.propostas.save({
      ...proposta,
      status: StatusProposta.DESCARTADA,
      decididaEm: new Date(),
      decididaPorId: usuarioId,
      observacaoDaDecisao: decisao.observacao ?? null,
    });

    await this.auditar(
      usuarioId,
      'conhecimento.proposta.descartar',
      {
        id: proposta.id,
        titulo: proposta.titulo,
        observacao: descartada.observacaoDaDecisao,
      },
      `proposta "${proposta.titulo}" descartada (antes: pendente) — nada foi gravado no corpus`,
    );

    return this.resumir(descartada);
  }

  private async exigirPendente(
    id: string,
    acao: string,
  ): Promise<PropostaConhecimento> {
    const proposta = await this.propostas.findOne({ where: { id } });

    if (!proposta) {
      throw new NotFoundException(`proposta "${id}" não existe`);
    }

    if (proposta.status !== StatusProposta.PENDENTE) {
      throw new ConflictException(
        `não dá para ${acao}: a proposta "${proposta.titulo}" ${
          VERBO_DO_STATUS[proposta.status]
        }${
          proposta.decididaEm ? ` em ${proposta.decididaEm.toISOString()}` : ''
        } — uma proposta só é decidida uma vez`,
      );
    }

    return proposta;
  }

  private async exigirModuloConhecido(moduloId: string | null): Promise<void> {
    if (!moduloId) {
      return;
    }

    const modulos = await this.configuracao.modulos();

    if (!modulos.some((modulo) => modulo.id === moduloId)) {
      throw new NotFoundException(`módulo "${moduloId}" não existe`);
    }
  }

  private async notaDaProposta(
    proposta: PropostaConhecimento,
    titulo: string,
    corpo: string,
    usuarioId: string | null,
  ): Promise<{ nota: NotaGravada; regravada: boolean }> {
    const reservado = proposta.notaSlug;

    if (reservado) {
      const regravada = await this.regravarNotaReservada(
        reservado,
        corpo,
        usuarioId,
      );

      if (regravada) {
        return { nota: regravada, regravada: true };
      }
    }

    const nota = await this.gravarNotaNova(proposta, titulo, corpo, usuarioId);

    return { nota, regravada: false };
  }

  private async regravarNotaReservada(
    slug: string,
    corpo: string,
    usuarioId: string | null,
  ): Promise<NotaGravada | null> {
    try {
      return await this.conhecimento.editarNota(slug, corpo, usuarioId);
    } catch (erro) {
      if (!(erro instanceof NotFoundException)) {
        throw erro;
      }

      this.logger.warn(
        `a nota "${slug}", reservada por uma aprovação anterior desta proposta, não está mais no corpus — vai ser gravada de novo`,
      );

      return null;
    }
  }

  private async gravarNotaNova(
    proposta: PropostaConhecimento,
    titulo: string,
    corpo: string,
    usuarioId: string | null,
  ): Promise<NotaGravada> {
    const nota = await this.conhecimento.criarNota(
      { titulo, conteudo: corpo },
      usuarioId,
    );

    try {
      await this.propostas.update(proposta.id, { notaSlug: nota.slug });
    } catch (erro) {
      await this.removerNotaOrfa(nota, usuarioId);

      throw erro;
    }

    proposta.notaSlug = nota.slug;

    return nota;
  }

  private async removerNotaOrfa(
    nota: NotaGravada,
    usuarioId: string | null,
  ): Promise<void> {
    try {
      await this.conhecimento.removerNota(nota.slug, usuarioId);
    } catch (erro) {
      this.logger.error(
        `a nota "${nota.slug}" ficou em ${nota.caminho} sem a proposta ter registrado a reserva, e não foi possível removê-la — apague-a do corpus à mão antes de reaprovar, senão a reaprovação cria uma segunda: ${
          erro instanceof Error ? erro.message : String(erro)
        }`,
      );
    }
  }

  private async classificarNoModulo(
    nota: NotaGravada,
    moduloId: string | null,
    usuarioId: string | null,
  ): Promise<void> {
    if (!moduloId || !nota.id) {
      return;
    }

    try {
      await this.configuracao.moverDocumentos([nota.id], moduloId, usuarioId);
    } catch (erro) {
      this.logger.error(
        `nota "${nota.slug}" gravada, mas não entrou no módulo ${moduloId} — classifique pela tela de módulos: ${
          erro instanceof Error ? erro.message : String(erro)
        }`,
      );
    }
  }

  private resumir(proposta: PropostaConhecimento): PropostaResumida {
    return {
      id: proposta.id,
      titulo: proposta.titulo,
      conteudo: proposta.conteudo,
      justificativa: proposta.justificativa,
      origemCaminho: proposta.origemCaminho,
      moduloId: proposta.moduloId,
      status: proposta.status,
      criadaEm: proposta.criadaEm,
      decididaEm: proposta.decididaEm,
      decididaPorId: proposta.decididaPorId,
      observacaoDaDecisao: proposta.observacaoDaDecisao,
      notaSlug: proposta.notaSlug ?? null,
    };
  }

  private async auditar(
    usuarioId: string | null | undefined,
    acao: string,
    argumento: Record<string, unknown>,
    resultado: string,
  ): Promise<void> {
    await this.seguranca.registrar({
      usuarioId: usuarioId ?? null,
      pergunta: `proposta de conhecimento: ${acao}`,
      ferramentas: [{ nome: acao, argumento, status: 'aplicada' }],
      fontes: 0,
      resultado,
      tom: 'configuracao',
      duracaoMs: 0,
      modelo: '(propostas)',
    });
  }
}
