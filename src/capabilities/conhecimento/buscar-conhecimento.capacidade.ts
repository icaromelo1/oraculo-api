import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { NomeFerramenta } from '../../contracts/eventos';
import { OraculoConfig } from '../../config/config.service';
import { ConfiguracaoService } from '../../config/configuracao.service';
import { Trecho } from '../../database/entities';
import { EmbeddingService } from '../../corpus/embedding.service';
import type { RetornoFerramenta } from '../../security/tipos';
import {
  Capacidade,
  ParametroCapacidade,
  ResultadoCapacidade,
} from '../capacidade';
import { LIMITE_PADRAO, LIMITE_TETO, normalizarLimite } from './limite';
import { fundirComRrf, ItemFundivel } from './rrf';

export const TETO_DE_TRECHO_CHARS = 1_800;

export function encurtarTrecho(texto: string): string {
  if (texto.length <= TETO_DE_TRECHO_CHARS) {
    return texto;
  }

  const corte = texto.lastIndexOf('\n', TETO_DE_TRECHO_CHARS);
  const fim = corte > TETO_DE_TRECHO_CHARS / 2 ? corte : TETO_DE_TRECHO_CHARS;

  return `${texto.slice(0, fim).trimEnd()}\n[trecho cortado — abra o documento para ver o restante]`;
}

const FATOR_POOL = 5;
const POOL_MINIMO = 20;

interface LenteDeModulo {
  id: string | null;
  aviso: string;
}

interface LinhaTrecho extends ItemFundivel {
  texto: string;
  linhaInicio: number;
  linhaFim: number;
  caminho: string;
  titulo: string;
  fonte: string;
}

const SELECAO = `
  SELECT
    t.id AS id,
    t.texto AS texto,
    t.linha_inicio AS "linhaInicio",
    t.linha_fim AS "linhaFim",
    d.caminho AS caminho,
    d.titulo AS titulo,
    d.fonte AS fonte,
    d.autoridade AS autoridade
  FROM trecho t
  JOIN documento d ON d.id = t.documento_id
`;

const FILTRO_DE_MODULO = ' AND d.modulo_id = $3';

function sqlLexical(comModulo: boolean): string {
  return `${SELECAO}
  WHERE t.busca @@ websearch_to_tsquery('portuguese', $1)${
    comModulo ? FILTRO_DE_MODULO : ''
  }
  ORDER BY ts_rank_cd(t.busca, websearch_to_tsquery('portuguese', $1)) DESC
  LIMIT $2
`;
}

const SONDAS_IVFFLAT = 10;

function sqlVetorial(comModulo: boolean): string {
  return `${SELECAO}
  WHERE t.embedding IS NOT NULL${comModulo ? FILTRO_DE_MODULO : ''}
  ORDER BY t.embedding <=> $1::vector ASC
  LIMIT $2
`;
}

@Injectable()
export class BuscarConhecimentoCapacidade implements Capacidade {
  readonly nome: NomeFerramenta = 'buscar_conhecimento';
  readonly descricao =
    'Busca híbrida (léxica + vetorial) no corpus indexado do Oráculo — memória, agentes, documentação e código. Devolve os trechos mais relevantes com procedência.';
  readonly sensivel = false;
  readonly chaveEnv = 'conhecimento' as const;
  readonly parametros: ParametroCapacidade[] = [
    {
      nome: 'consulta',
      tipo: 'string',
      descricao: 'texto de busca em linguagem natural',
      obrigatorio: true,
    },
    {
      nome: 'limite',
      tipo: 'inteiro',
      descricao: `quantidade máxima de trechos devolvidos (padrão ${LIMITE_PADRAO}, teto ${LIMITE_TETO})`,
      obrigatorio: false,
    },
    {
      nome: 'modulo',
      tipo: 'string',
      descricao:
        'nome de um módulo do mapa do conhecimento — restringe a busca aos documentos daquele módulo',
      obrigatorio: false,
    },
  ];

  constructor(
    private readonly config: OraculoConfig,
    private readonly embedding: EmbeddingService,
    @InjectRepository(Trecho)
    private readonly trechos: Repository<Trecho>,
    @Optional() private readonly configuracao?: ConfiguracaoService,
  ) {}

  async executar(
    argumentos: Record<string, unknown>,
  ): Promise<ResultadoCapacidade> {
    if (this.config.corpus.fontes.length === 0) {
      return {
        retornos: [],
        metrica: 'nenhuma fonte configurada em CORPUS_FONTES — corpus vazio',
        volume: 0,
      };
    }

    const consulta = this.textoConsulta(argumentos);

    if (!consulta) {
      return {
        retornos: [],
        metrica: 'consulta vazia',
        volume: 0,
      };
    }

    const limite = normalizarLimite(argumentos.limite);
    const modo = this.config.recuperacao.modo;
    const poolTamanho = Math.max(limite * FATOR_POOL, POOL_MINIMO);
    const lente = await this.resolverModulo(argumentos);

    const rankings: LinhaTrecho[][] = [];

    if (modo !== 'vetorial') {
      rankings.push(await this.buscarLexical(consulta, poolTamanho, lente.id));
    }

    if (modo !== 'lexical') {
      rankings.push(await this.buscarVetorial(consulta, poolTamanho, lente.id));
    }

    const selecionados = fundirComRrf(rankings).slice(0, limite);

    return {
      retornos: selecionados.map((item) => this.paraRetorno(item)),
      metrica: `${selecionados.length} trecho(s) encontrado(s) — modo ${modo}${lente.aviso}`,
      volume: selecionados.length,
    };
  }

  private textoConsulta(argumentos: Record<string, unknown>): string {
    return typeof argumentos.consulta === 'string'
      ? argumentos.consulta.trim()
      : '';
  }

  private async resolverModulo(
    argumentos: Record<string, unknown>,
  ): Promise<LenteDeModulo> {
    const pedido =
      typeof argumentos.modulo === 'string' ? argumentos.modulo.trim() : '';

    if (!pedido) {
      return { id: null, aviso: '' };
    }

    const encontrado = await this.configuracao?.identificarModulo(pedido);

    if (!encontrado) {
      return {
        id: null,
        aviso: ` — o módulo "${pedido}" não existe no mapa, então a busca correu sem filtro de módulo`,
      };
    }

    return { id: encontrado.id, aviso: ` — módulo "${encontrado.nome}"` };
  }

  private async buscarLexical(
    consulta: string,
    poolTamanho: number,
    moduloId: string | null = null,
  ): Promise<LinhaTrecho[]> {
    return this.trechos.query(
      sqlLexical(moduloId !== null),
      moduloId === null
        ? [consulta, poolTamanho]
        : [consulta, poolTamanho, moduloId],
    );
  }

  private async buscarVetorial(
    consulta: string,
    poolTamanho: number,
    moduloId: string | null = null,
  ): Promise<LinhaTrecho[]> {
    const [vetor] = await this.embedding.embutir([consulta], {
      prefixo: 'query',
    });
    const literalVetor = `[${vetor.join(',')}]`;

    return this.trechos.manager.transaction(async (gerente) => {
      await gerente.query(`SET LOCAL ivfflat.probes = ${SONDAS_IVFFLAT}`);

      return gerente.query<LinhaTrecho[]>(
        sqlVetorial(moduloId !== null),
        moduloId === null
          ? [literalVetor, poolTamanho]
          : [literalVetor, poolTamanho, moduloId],
      );
    });
  }

  private paraRetorno(item: LinhaTrecho): RetornoFerramenta {
    return {
      origem: {
        ferramenta: this.nome,
        tipo: item.fonte,
        caminho: item.caminho,
        titulo: item.titulo,
        meta: `linhas ${item.linhaInicio}-${item.linhaFim}`,
      },
      conteudo: encurtarTrecho(item.texto),
    };
  }
}
