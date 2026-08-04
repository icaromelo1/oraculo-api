import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OraculoConfig } from '../config/config.service';
import {
  AlvoBancoResumido,
  CapacidadeEfetiva,
  ConfiguracaoService,
  FonteEfetiva,
  ServicoResumido,
} from '../config/configuracao.service';
import { Documento } from '../database/entities';

export interface ContagemCorpus {
  fonte: string;
  autoridade: number;
  documentos: number;
}

export interface EstadoDoAmbiente {
  capacidades: CapacidadeEfetiva[];
  fontes: FonteEfetiva[];
  alvosBanco: AlvoBancoResumido[];
  servicos: ServicoResumido[];
  corpus: {
    total: number;
    porFonte: ContagemCorpus[];
  };
  provedor: {
    tipo: string;
    modelo: string;
  };
  ultimaIndexacao: Date | null;
}

@Injectable()
export class AmbienteService {
  constructor(
    private readonly config: OraculoConfig,
    private readonly configuracao: ConfiguracaoService,
    @InjectRepository(Documento)
    private readonly documentos: Repository<Documento>,
  ) {}

  async estado(): Promise<EstadoDoAmbiente> {
    const [capacidades, fontes, alvosBanco, servicos, porFonte, ultimo] =
      await Promise.all([
        this.configuracao.capacidadesEfetivas(),
        this.configuracao.fontesEfetivas(),
        this.configuracao.alvosBanco(),
        this.configuracao.servicosObservaveis(),
        this.contarCorpus(),
        this.ultimoDocumento(),
      ]);

    return {
      capacidades,
      fontes,
      alvosBanco,
      servicos,
      corpus: {
        total: porFonte.reduce((soma, item) => soma + item.documentos, 0),
        porFonte,
      },
      provedor: this.provedor(),
      ultimaIndexacao: ultimo?.atualizadoEm ?? null,
    };
  }

  private provedor(): { tipo: string; modelo: string } {
    const provedor = this.config.provedor;

    if (provedor.tipo === 'anthropic') {
      return { tipo: provedor.tipo, modelo: provedor.anthropicModelo };
    }

    if (provedor.tipo === 'openai-compat') {
      return {
        tipo: provedor.tipo,
        modelo: provedor.openaiModelo ?? '(não definido)',
      };
    }

    return {
      tipo: provedor.tipo,
      modelo: provedor.cliModelo ?? provedor.cliComando,
    };
  }

  private async contarCorpus(): Promise<ContagemCorpus[]> {
    const linhas = await this.documentos
      .createQueryBuilder('documento')
      .select('documento.fonte', 'fonte')
      .addSelect('documento.autoridade', 'autoridade')
      .addSelect('COUNT(*)', 'documentos')
      .groupBy('documento.fonte')
      .addGroupBy('documento.autoridade')
      .orderBy('documento.fonte', 'ASC')
      .getRawMany<{
        fonte: string;
        autoridade: number | string;
        documentos: number | string;
      }>();

    return linhas.map((linha) => ({
      fonte: linha.fonte,
      autoridade: Number(linha.autoridade),
      documentos: Number(linha.documentos),
    }));
  }

  private async ultimoDocumento(): Promise<Documento | null> {
    return this.documentos.findOne({
      where: {},
      order: { atualizadoEm: 'DESC' },
    });
  }
}
