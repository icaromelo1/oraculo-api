import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { RegistryCapacidades } from '../capabilities/registry.service';
import { OraculoConfig } from '../config/config.service';
import type {
  EventoErro,
  EventoOraculo,
  NomeFerramenta,
} from '../contracts/eventos';
import { LLM_PROVIDER, type LlmProvider } from '../providers/llm-provider';
import { SecurityService } from '../security/security.service';
import type { AlcancePerfil, OcorrenciaRedacao } from '../security/tipos';
import { calcularCobertura } from './cobertura';
import { FluxoResposta } from './fluxo-resposta';
import { lerMapaExibicao } from './caminho-exibicao';
import { construirFonte } from './fonte';
import { montarSistema } from './instrucao';
import {
  avisoDeBloqueio,
  avisoDeBlocoInvalido,
  avisoDeFalha,
  avisoSemResultado,
  lerBloco,
} from './protocolo';
import {
  novoEstado,
  type ContextoTurno,
  type EstadoTurno,
  type MensagemTurno,
} from './tipos';

const EXPIRACAO_APROVACAO_MS = 5 * 60 * 1000;
const MAX_ARGUMENTO = 220;

const EFEITOS: Record<string, string> = {
  buscar_conhecimento: 'leitura do indice de conhecimento',
  ler_documento: 'leitura de documento indexado',
  ler_arquivo: 'leitura de arquivo do repositorio',
  consultar_banco: 'consulta somente leitura em banco vivo',
  estado_servicos: 'execucao de comando de estado da allowlist',
};

interface Ambiente {
  alcance: AlcancePerfil;
  contexto: ContextoTurno;
  pergunta: string;
  modelo: string;
  estado: EstadoTurno;
  retornos: string[];
}

function descreverFalha(falha: unknown): string {
  return falha instanceof Error ? falha.message : String(falha);
}

@Injectable()
export class MotorOraculo {
  private readonly logger = new Logger(MotorOraculo.name);

  constructor(
    @Inject(LLM_PROVIDER) private readonly provedor: LlmProvider,
    private readonly registry: RegistryCapacidades,
    private readonly security: SecurityService,
    private readonly config: OraculoConfig,
  ) {}

  private get mapaExibicao() {
    return lerMapaExibicao(this.config.corpus?.exibicao ?? []);
  }

  async *responder(
    pergunta: string,
    contexto: ContextoTurno,
  ): AsyncIterable<EventoOraculo> {
    const inicio = Date.now();
    const estado = novoEstado();

    try {
      try {
        yield* this.executar(pergunta, contexto, estado);

        if (!estado.resposta.trim()) {
          estado.tom = 'erro';
          yield {
            tipo: 'erro',
            codigo: 'resposta_vazia',
            mensagem:
              'o modelo não devolveu nada — provavelmente uma falha momentânea do provedor. Tente de novo; se repetir, confira o provedor configurado em Ambiente.',
            retomavel: true,
          };
        }
      } catch (falha) {
        estado.tom = 'erro';
        yield {
          tipo: 'erro',
          codigo: 'falha_interna',
          mensagem: descreverFalha(falha),
          retomavel: true,
        };
      }

      yield {
        tipo: 'mensagem.fim',
        cobertura: calcularCobertura(estado.resposta, estado.idsValidos),
        tokens: estado.tokens,
        duracaoMs: Date.now() - inicio,
      };
    } finally {
      await this.auditar(pergunta, contexto, estado, Date.now() - inicio);
    }
  }

  private async *executar(
    pergunta: string,
    contexto: ContextoTurno,
    estado: EstadoTurno,
  ): AsyncIterable<EventoOraculo> {
    const alcance = await this.security.carregarAlcance(contexto.perfilId);
    const modelo = this.provedor.nome;
    const sistema = montarSistema(
      this.registry.descreverPara(alcance),
      this.security.instrucaoDeSistema(),
    );
    const mensagens: MensagemTurno[] = [
      ...(contexto.historico ?? []),
      { papel: 'usuario', texto: pergunta },
    ];

    yield {
      tipo: 'mensagem.inicio',
      id: randomUUID(),
      conversaId: contexto.conversaId ?? randomUUID(),
      modelo,
      escopo: contexto.escopo ?? { repositorios: [], alvos: [] },
    };

    const { maxIteracoes, maxTokensSaida } = this.config.engine;
    const orcamento = maxTokensSaida * maxIteracoes;

    while (true) {
      const teto = this.conferirTetos(estado, maxIteracoes, orcamento);

      if (teto) {
        estado.tom = 'limite';
        yield teto;

        return;
      }

      estado.iteracoes += 1;

      const fluxo = new FluxoResposta(
        (texto) => this.security.protegerSaida(texto),
        estado.idsValidos,
      );
      let falha: EventoErro | null = null;

      for await (const evento of this.provedor.gerar({
        sistema,
        mensagens,
        maxTokens: maxTokensSaida,
      })) {
        if (evento.tipo === 'raciocinio') {
          continue;
        }

        if (evento.tipo === 'texto') {
          const parte = fluxo.empurrar(evento.fragmento);

          if (parte) {
            yield { tipo: 'texto.delta', fragmento: parte };
          }

          continue;
        }

        if (evento.tipo === 'fim') {
          estado.tokens += evento.tokensEntrada + evento.tokensSaida;
          estado.tokensSaida += evento.tokensSaida;

          continue;
        }

        falha = {
          tipo: 'erro',
          codigo: evento.codigo,
          mensagem: evento.mensagem,
          retomavel: evento.retomavel,
        };

        break;
      }

      const resto = fluxo.encerrar();

      if (resto) {
        yield { tipo: 'texto.delta', fragmento: resto };
      }

      estado.resposta += fluxo.texto;

      if (falha) {
        estado.tom = 'erro';
        yield falha;

        return;
      }

      const blocos = fluxo.blocos;

      if (blocos.length === 0) {
        return;
      }

      mensagens.push({ papel: 'assistente', texto: fluxo.bruto });

      const retornos: string[] = [];
      const ambiente: Ambiente = {
        alcance,
        contexto,
        pergunta,
        modelo,
        estado,
        retornos,
      };

      for (const bloco of blocos) {
        yield* this.atender(bloco, ambiente);
      }

      mensagens.push({ papel: 'usuario', texto: retornos.join('\n\n') });
    }
  }

  private conferirTetos(
    estado: EstadoTurno,
    maxIteracoes: number,
    orcamento: number,
  ): EventoErro | null {
    if (estado.iteracoes >= maxIteracoes) {
      return {
        tipo: 'erro',
        codigo: 'limite_iteracoes',
        mensagem: `o laco parou no teto de ${maxIteracoes} iteracoes sem chegar a uma resposta final`,
        retomavel: true,
      };
    }

    if (estado.tokensSaida >= orcamento) {
      return {
        tipo: 'erro',
        codigo: 'limite_tokens',
        mensagem: `o turno gastou o teto de ${orcamento} tokens de saida`,
        retomavel: true,
      };
    }

    return null;
  }

  private async *atender(
    bloco: string,
    ambiente: Ambiente,
  ): AsyncIterable<EventoOraculo> {
    const leitura = lerBloco(bloco);

    if (!leitura.ok) {
      ambiente.retornos.push(avisoDeBlocoInvalido(leitura.motivo));

      return;
    }

    const { ferramenta, argumentos } = leitura.pedido;
    const id = randomUUID();
    const capacidade = this.registry.obterDisponivel(
      ferramenta,
      ambiente.alcance,
    );
    const argumento = this.resumir(argumentos);

    yield {
      tipo: 'ferramenta.inicio',
      id,
      nome: ferramenta as NomeFerramenta,
      argumento,
      sensivel: capacidade?.sensivel ?? true,
    };

    const veredito = await this.security.avaliarPedido({
      capacidade: ferramenta,
      argumentos,
      alcance: ambiente.alcance,
      usuarioId: ambiente.contexto.usuarioId,
      pergunta: ambiente.pergunta,
      modelo: ambiente.modelo,
    });

    if (veredito.decisao === 'exigir_aprovacao') {
      yield {
        tipo: 'aprovacao.pedido',
        id,
        comando: ferramenta,
        alvo: this.alvo(argumentos),
        efeitoColateral: EFEITOS[ferramenta] ?? 'efeito desconhecido',
        politica: veredito.politica,
        expiraEm: new Date(Date.now() + EXPIRACAO_APROVACAO_MS).toISOString(),
      };
    }

    if (veredito.decisao !== 'permitir') {
      const motivo =
        veredito.decisao === 'exigir_aprovacao'
          ? `aguardando aprovacao — ${veredito.motivo}`
          : veredito.motivo;

      ambiente.estado.tom = 'bloqueio_parcial';
      ambiente.estado.bloqueios.push({
        capacidade: ferramenta,
        decisao: veredito.decisao,
        politica: veredito.politica,
        motivo,
        argumento: argumentos,
      });
      ambiente.estado.execucoes.push({
        nome: ferramenta,
        argumento: argumentos,
        status: 'bloqueada',
        duracaoMs: 0,
      });
      ambiente.retornos.push(avisoDeBloqueio(ferramenta, motivo));

      yield {
        tipo: 'ferramenta.fim',
        id,
        status: 'bloqueada',
        metrica: 'nao executada',
        duracaoMs: 0,
        resultado: motivo,
      };

      return;
    }

    if (!capacidade) {
      const motivo = `"${ferramenta}" nao esta registrada nesta instalacao`;

      ambiente.estado.execucoes.push({
        nome: ferramenta,
        argumento: argumentos,
        status: 'erro',
        duracaoMs: 0,
      });
      ambiente.retornos.push(avisoDeFalha(ferramenta, motivo));

      yield {
        tipo: 'ferramenta.fim',
        id,
        status: 'erro',
        metrica: 'nao executada',
        duracaoMs: 0,
        resultado: motivo,
      };

      return;
    }

    const comeco = Date.now();

    try {
      const produto = await capacidade.executar(argumentos, {
        alcance: ambiente.alcance,
        usuarioId: ambiente.contexto.usuarioId,
      });
      const duracaoMs = Date.now() - comeco;
      const redacoes: OcorrenciaRedacao[] = [];
      const partes: string[] = [];

      for (const retorno of produto.retornos) {
        const protegido = this.security.protegerRetorno(retorno);
        redacoes.push(...protegido.redacao.ocorrencias);

        const fonte = construirFonte(retorno, protegido, this.mapaExibicao);

        if (!ambiente.estado.fontes.has(fonte.id)) {
          ambiente.estado.fontes.set(fonte.id, fonte);
          ambiente.estado.idsValidos.add(fonte.id);

          yield { tipo: 'citacao', fonte, ferramentaId: id };
        }

        partes.push(
          `${protegido.texto}\ncite este trecho como [[F:${fonte.id}]]`,
        );
      }

      ambiente.estado.execucoes.push({
        nome: ferramenta,
        argumento: argumentos,
        status: 'concluida',
        duracaoMs,
        redacoes,
      });
      ambiente.retornos.push(
        partes.length ? partes.join('\n\n') : avisoSemResultado(ferramenta),
      );

      yield {
        tipo: 'ferramenta.fim',
        id,
        status: 'concluida',
        metrica: produto.metrica,
        duracaoMs,
        plano: produto.plano,
        resultado: `${produto.retornos.length} trecho(s) devolvido(s)`,
      };
    } catch (falha) {
      const motivo = descreverFalha(falha);

      ambiente.estado.execucoes.push({
        nome: ferramenta,
        argumento: argumentos,
        status: 'erro',
        duracaoMs: Date.now() - comeco,
      });
      ambiente.retornos.push(avisoDeFalha(ferramenta, motivo));

      yield {
        tipo: 'ferramenta.fim',
        id,
        status: 'erro',
        metrica: 'falhou',
        duracaoMs: Date.now() - comeco,
        resultado: motivo,
      };
    }
  }

  private resumir(argumentos: Record<string, unknown>): string {
    const bruto = JSON.stringify(argumentos) ?? '{}';
    const limitado =
      bruto.length > MAX_ARGUMENTO
        ? `${bruto.slice(0, MAX_ARGUMENTO)}...`
        : bruto;

    return this.security.protegerSaida(limitado).texto;
  }

  private alvo(argumentos: Record<string, unknown>): string {
    for (const chave of ['caminho', 'alvo', 'comando', 'consulta', 'sql']) {
      const valor = argumentos[chave];

      if (typeof valor === 'string' && valor.trim()) {
        return valor.trim();
      }
    }

    return '(sem alvo declarado)';
  }

  private async auditar(
    pergunta: string,
    contexto: ContextoTurno,
    estado: EstadoTurno,
    duracaoMs: number,
  ): Promise<void> {
    try {
      await this.security.registrar({
        usuarioId: contexto.usuarioId,
        pergunta,
        ferramentas: estado.execucoes,
        bloqueios: estado.bloqueios,
        fontes: estado.fontes.size,
        resultado: estado.resposta,
        tom: estado.tom,
        duracaoMs,
        modelo: this.provedor.nome,
      });
    } catch (falha) {
      this.logger.error(
        `falha ao registrar o turno na auditoria: ${descreverFalha(falha)}`,
      );
    }
  }
}
