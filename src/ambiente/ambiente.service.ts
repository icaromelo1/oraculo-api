import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { Repository } from 'typeorm';
import { OraculoConfig } from '../config/config.service';
import {
  AlvoBancoResumido,
  CapacidadeEfetiva,
  ConfiguracaoService,
  FonteEfetiva,
  ProvedorResumido,
  ServicoResumido,
} from '../config/configuracao.service';
import {
  ItemDaAmostra,
  OpcoesDePrevia,
  preverFonte,
} from '../corpus/varredura.service';
import { Documento } from '../database/entities';

export interface ContagemCorpus {
  fonte: string;
  autoridade: number;
  documentos: number;
}

export interface PreviaDeFonte {
  caminho: string;
  existe: boolean;
  legivel: boolean;
  arquivosElegiveis: number;
  arquivosRecusados: number;
  bytesTotais: number;
  porExtensao: Record<string, number>;
  amostra: ItemDaAmostra[];
  motivosDeRecusa: Record<string, number>;
  truncada: boolean;
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
    origem: 'env' | 'banco';
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
    const [
      capacidades,
      fontes,
      alvosBanco,
      servicos,
      provedores,
      porFonte,
      ultimo,
    ] = await Promise.all([
      this.configuracao.capacidadesEfetivas(),
      this.configuracao.fontesEfetivas(),
      this.configuracao.alvosBanco(),
      this.configuracao.servicosObservaveis(),
      this.configuracao.provedores(),
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
      provedor: this.provedor(provedores.find((item) => item.ativo)),
      ultimaIndexacao: ultimo?.atualizadoEm ?? null,
    };
  }

  async previaDeFonte(
    caminho: string,
    opcoes: OpcoesDePrevia = {},
  ): Promise<PreviaDeFonte> {
    const alvo = await this.configuracao.resolverCaminhoDeFonte(caminho);

    if (!alvo.existe) {
      return this.previaVazia(alvo.real, false, false);
    }

    if (!(await stat(alvo.real)).isDirectory()) {
      throw new BadRequestException(
        `"${alvo.informado}" não é uma pasta — uma fonte de conhecimento é sempre um diretório`,
      );
    }

    const legivel = await access(alvo.real, constants.R_OK | constants.X_OK)
      .then(() => true)
      .catch(() => false);

    if (!legivel) {
      return this.previaVazia(alvo.real, true, false);
    }

    const previa = await preverFonte(
      alvo.real,
      this.config.corpus.negados,
      opcoes,
    );

    return { caminho: alvo.real, existe: true, legivel: true, ...previa };
  }

  private previaVazia(
    caminho: string,
    existe: boolean,
    legivel: boolean,
  ): PreviaDeFonte {
    return {
      caminho,
      existe,
      legivel,
      arquivosElegiveis: 0,
      arquivosRecusados: 0,
      bytesTotais: 0,
      porExtensao: {},
      amostra: [],
      motivosDeRecusa: {},
      truncada: false,
    };
  }

  private provedor(ativo?: ProvedorResumido): {
    tipo: string;
    modelo: string;
    origem: 'env' | 'banco';
  } {
    if (ativo) {
      return {
        tipo: ativo.tipo,
        modelo: ativo.modelo ?? ativo.comando ?? '(não definido)',
        origem: 'banco',
      };
    }

    return { ...this.provedorDoEnv(), origem: 'env' };
  }

  private provedorDoEnv(): { tipo: string; modelo: string } {
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
