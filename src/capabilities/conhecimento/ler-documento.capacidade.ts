import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { NomeFerramenta } from '../../contracts/eventos';
import { Documento, Trecho } from '../../database/entities';
import type { RetornoFerramenta } from '../../security/tipos';
import {
  Capacidade,
  ParametroCapacidade,
  ResultadoCapacidade,
} from '../capacidade';

@Injectable()
export class LerDocumentoCapacidade implements Capacidade {
  readonly nome: NomeFerramenta = 'ler_documento';
  readonly descricao =
    'Devolve o conteúdo completo de um documento já indexado pelo Oráculo (ou um trecho específico dele), para quando a busca não trouxe contexto suficiente.';
  readonly sensivel = false;
  readonly chaveEnv = 'conhecimento' as const;
  readonly parametros: ParametroCapacidade[] = [
    {
      nome: 'caminho',
      tipo: 'string',
      descricao: 'caminho absoluto do documento, exatamente como indexado',
      obrigatorio: true,
    },
    {
      nome: 'trechoId',
      tipo: 'string',
      descricao:
        'id de um trecho específico já visto (ex.: numa citação anterior) — se omitido, devolve o documento inteiro',
      obrigatorio: false,
    },
  ];

  constructor(
    @InjectRepository(Documento)
    private readonly documentos: Repository<Documento>,
    @InjectRepository(Trecho)
    private readonly trechos: Repository<Trecho>,
  ) {}

  async executar(
    argumentos: Record<string, unknown>,
  ): Promise<ResultadoCapacidade> {
    const caminho = this.texto(argumentos.caminho);

    if (!caminho) {
      return { retornos: [], metrica: 'caminho vazio', volume: 0 };
    }

    const documento = await this.documentos.findOne({ where: { caminho } });

    if (!documento) {
      return {
        retornos: [],
        metrica: `"${caminho}" não está indexado pelo Oráculo`,
        volume: 0,
      };
    }

    const trechoId = this.texto(argumentos.trechoId);

    const trechosDoDocumento = await this.trechos.find({
      where: trechoId
        ? { id: trechoId, documento: { id: documento.id } }
        : { documento: { id: documento.id } },
      order: { ordem: 'ASC' },
    });

    if (trechosDoDocumento.length === 0) {
      return {
        retornos: [],
        metrica: trechoId
          ? `trecho "${trechoId}" não encontrado em "${caminho}"`
          : `"${caminho}" está indexado mas não tem trechos`,
        volume: 0,
      };
    }

    const retornos: RetornoFerramenta[] = trechosDoDocumento.map((trecho) => ({
      origem: {
        ferramenta: this.nome,
        tipo: documento.fonte,
        caminho: documento.caminho,
        titulo: documento.titulo,
        meta: `linhas ${trecho.linhaInicio}-${trecho.linhaFim}`,
      },
      conteudo: trecho.texto,
    }));

    return {
      retornos,
      metrica: `${retornos.length} trecho(s) de "${documento.titulo}"`,
      volume: retornos.length,
    };
  }

  private texto(valor: unknown): string {
    return typeof valor === 'string' ? valor.trim() : '';
  }
}
