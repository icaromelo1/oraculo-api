import { Injectable } from '@nestjs/common';
import { OraculoConfig } from '../../config/config.service';
import { ConfiguracaoService } from '../../config/configuracao.service';
import { SanitizadorDiagnostico } from '../../security/sanitizador-diagnostico';
import type { RetornoFerramenta } from '../../security/tipos';
import type {
  Capacidade,
  ParametroCapacidade,
  ResultadoCapacidade,
} from '../capacidade';
import {
  CATALOGO_DIAGNOSTICO,
  IDS_DO_CATALOGO,
  descreverEntrada,
  descreverPasso,
  montarArgumentos,
  nomeDeServicoBemFormado,
  normalizarLinhas,
  obterEntrada,
  type EntradaCatalogo,
  type NomeArgumento,
} from './catalogo';
import { ExecutorDiagnostico } from './executor.service';

type ValoresVariaveis = Partial<Record<NomeArgumento, string>>;

type ResolucaoArgumentos =
  { ok: true; valores: ValoresVariaveis } | { ok: false; motivo: string };

export interface ArgumentoDoCatalogo {
  nome: string;
  tipo: string;
  obrigatorio: boolean;
  descricao: string;
  minimo: number | null;
  maximo: number | null;
  padrao: number | null;
}

export interface EntradaDoCatalogoExibida {
  id: string;
  descricao: string;
  liberadaNoEnv: boolean;
  comandos: string[];
  argumentos: ArgumentoDoCatalogo[];
}

export interface CatalogoExibido {
  ferramenta: string;
  tetoDoEnv: boolean;
  ligada: boolean;
  liberadosNoEnv: string[];
  entradas: EntradaDoCatalogoExibida[];
}

@Injectable()
export class DiagnosticoCapacidade implements Capacidade {
  readonly nome = 'estado_servicos' as const;
  readonly descricao = `roda um diagnóstico de leitura do servidor escolhendo um id do catálogo fechado (${IDS_DO_CATALOGO.join(
    ', ',
  )}); não existe comando livre`;
  readonly sensivel = true;
  readonly chaveEnv = 'estado' as const;
  readonly parametros: ParametroCapacidade[] = [
    {
      nome: 'comando',
      tipo: 'string',
      descricao: `id do catálogo de diagnóstico: ${IDS_DO_CATALOGO.join(', ')}`,
      obrigatorio: true,
    },
    {
      nome: 'servico',
      tipo: 'string',
      descricao:
        'nome de um serviço cadastrado e ativo, exigido por servico_logs e estado_containers',
      obrigatorio: false,
    },
    {
      nome: 'linhas',
      tipo: 'inteiro',
      descricao: 'linhas de log a devolver em servico_logs (1 a 200)',
      obrigatorio: false,
    },
  ];

  constructor(
    private readonly executor: ExecutorDiagnostico,
    private readonly sanitizador: SanitizadorDiagnostico,
    private readonly config: OraculoConfig,
    private readonly configuracao: ConfiguracaoService,
  ) {}

  async executar(
    argumentos: Record<string, unknown>,
  ): Promise<ResultadoCapacidade> {
    if (!this.config.capacidades.estado) {
      return this.bloqueio('CAP_ESTADO=off no .env desta instalação');
    }

    if (!this.configuracao.capacidadeLigada('estado')) {
      return this.bloqueio('diagnóstico desligado na configuração do Oráculo');
    }

    const entrada = obterEntrada(
      typeof argumentos.comando === 'string'
        ? argumentos.comando.trim()
        : argumentos.comando,
    );

    if (!entrada) {
      return this.bloqueio(
        `comando fora do catálogo de diagnóstico — os únicos aceitos são ${IDS_DO_CATALOGO.join(
          ', ',
        )}`,
      );
    }

    if (!this.liberadaNoEnv(entrada.id)) {
      return this.bloqueio(
        `"${entrada.id}" não está em ESTADO_COMANDOS no .env desta instalação`,
      );
    }

    const resolucao = await this.resolverVariaveis(entrada, argumentos);

    if (!resolucao.ok) {
      return this.bloqueio(resolucao.motivo);
    }

    return this.rodar(entrada, resolucao.valores);
  }

  catalogoParaAuditoria(): CatalogoExibido {
    const tetoDoEnv = this.config.capacidades.estado;

    return {
      ferramenta: this.nome,
      tetoDoEnv,
      ligada: tetoDoEnv && this.configuracao.capacidadeLigada('estado'),
      liberadosNoEnv: [...this.config.escopos.comandos],
      entradas: CATALOGO_DIAGNOSTICO.map((entrada) => ({
        id: entrada.id,
        descricao: entrada.descricao,
        liberadaNoEnv: this.liberadaNoEnv(entrada.id),
        comandos: descreverEntrada(entrada),
        argumentos: entrada.argumentos.map((esquema) => ({
          nome: esquema.nome,
          tipo: esquema.tipo,
          obrigatorio: esquema.nome === 'servico',
          descricao: esquema.descricao,
          minimo: esquema.nome === 'linhas' ? esquema.minimo : null,
          maximo: esquema.nome === 'linhas' ? esquema.maximo : null,
          padrao: esquema.nome === 'linhas' ? esquema.padrao : null,
        })),
      })),
    };
  }

  private liberadaNoEnv(id: string): boolean {
    return this.config.escopos.comandos.includes(id);
  }

  private async resolverVariaveis(
    entrada: EntradaCatalogo,
    argumentos: Record<string, unknown>,
  ): Promise<ResolucaoArgumentos> {
    const valores: ValoresVariaveis = {};

    for (const esquema of entrada.argumentos) {
      if (esquema.nome === 'linhas') {
        const normalizado = normalizarLinhas(argumentos.linhas, esquema);

        if (!normalizado.ok) {
          return { ok: false, motivo: normalizado.motivo };
        }

        valores.linhas = String(normalizado.valor);

        continue;
      }

      const escolhido = await this.escolherServico(argumentos.servico);

      if (!escolhido.ok) {
        return escolhido;
      }

      valores.servico = escolhido.valores.servico;
    }

    return { ok: true, valores };
  }

  private async escolherServico(bruto: unknown): Promise<ResolucaoArgumentos> {
    const pedido = typeof bruto === 'string' ? bruto.trim() : '';

    if (!pedido) {
      return {
        ok: false,
        motivo: 'o argumento "servico" é obrigatório e precisa ser texto',
      };
    }

    if (!nomeDeServicoBemFormado(pedido)) {
      return {
        ok: false,
        motivo:
          'o nome do serviço tem caractere fora do formato aceito — só letras, números, ponto, hífen e sublinhado',
      };
    }

    const cadastrados = await this.configuracao.servicosObservaveis();
    const encontrado = cadastrados.find((servico) => servico.nome === pedido);

    if (!encontrado) {
      return {
        ok: false,
        motivo: `o serviço "${pedido}" não está cadastrado e ativo em servico_observavel`,
      };
    }

    if (!nomeDeServicoBemFormado(encontrado.nome)) {
      return {
        ok: false,
        motivo:
          'o nome cadastrado para esse serviço está fora do formato aceito e não pode ser usado',
      };
    }

    return { ok: true, valores: { servico: encontrado.nome } };
  }

  private async rodar(
    entrada: EntradaCatalogo,
    valores: ValoresVariaveis,
  ): Promise<ResultadoCapacidade> {
    const retornos: RetornoFerramenta[] = [];
    let concluidos = 0;

    for (const passo of entrada.passos) {
      const argumentos = montarArgumentos(passo, valores);

      if (!argumentos) {
        retornos.push(
          this.retorno(
            entrada,
            passo.id,
            passo.rotulo,
            descreverPasso(passo),
            'argumento obrigatório ausente — o passo não foi executado',
            false,
          ),
        );

        continue;
      }

      const resultado = await this.executor.executar(passo.binario, argumentos);

      if (resultado.ok) {
        concluidos += 1;
      }

      const bruto = resultado.ok
        ? resultado.saida.trim() || '(sem saída)'
        : (resultado.erro ?? 'falha desconhecida ao executar o diagnóstico');

      retornos.push(
        this.retorno(
          entrada,
          passo.id,
          passo.rotulo,
          descreverPasso(passo),
          bruto,
          resultado.truncada,
        ),
      );
    }

    return {
      retornos,
      metrica: `${entrada.id}: ${concluidos} de ${entrada.passos.length} passo(s)`,
      volume: retornos.length,
      plano: descreverEntrada(entrada).join('\n'),
    };
  }

  private retorno(
    entrada: EntradaCatalogo,
    passoId: string,
    rotulo: string,
    comando: string,
    bruto: string,
    truncada: boolean,
  ): RetornoFerramenta {
    const { texto } = this.sanitizador.sanitizar(bruto);

    return {
      origem: {
        ferramenta: this.nome,
        tipo: 'diagnostico',
        caminho: `diagnostico://${entrada.id}/${passoId}`,
        titulo: rotulo,
        meta: `comando ${comando}`,
      },
      conteudo: texto,
      truncado: truncada,
    };
  }

  private bloqueio(motivo: string): ResultadoCapacidade {
    return { retornos: [], metrica: `bloqueado: ${motivo}`, volume: 0 };
  }
}
