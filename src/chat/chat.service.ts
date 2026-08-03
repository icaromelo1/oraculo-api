import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request, Response } from 'express';
import { Repository } from 'typeorm';
import type { UsuarioAutenticado } from '../auth/autenticador';
import type {
  Cobertura,
  EventoOraculo,
  Fonte,
  NomeFerramenta,
  PedidoChat,
} from '../contracts/eventos';
import { serializarEvento } from '../contracts/eventos';
import {
  Aprovacao,
  Conversa,
  FerramentaExecucao,
  Mensagem,
  PapelMensagem,
  StatusAprovacao,
  StatusFerramentaExecucao,
  Usuario,
} from '../database/entities';
import { MotorOraculo } from '../engine/motor.service';
import type { ContextoTurno, MensagemTurno } from '../engine/tipos';
import { tituloDaConversa } from './titulo-conversa';

const CABECALHOS_SSE = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

interface FerramentaIniciada {
  nome: NomeFerramenta;
  argumento: string;
}

function descreverFalha(falha: unknown): string {
  return falha instanceof Error ? falha.message : String(falha);
}

@Injectable()
export class ChatService {
  constructor(
    private readonly motor: MotorOraculo,
    @InjectRepository(Conversa)
    private readonly conversas: Repository<Conversa>,
    @InjectRepository(Mensagem)
    private readonly mensagens: Repository<Mensagem>,
    @InjectRepository(FerramentaExecucao)
    private readonly ferramentas: Repository<FerramentaExecucao>,
    @InjectRepository(Aprovacao)
    private readonly aprovacoes: Repository<Aprovacao>,
  ) {}

  async transmitir(
    pedido: PedidoChat,
    usuario: UsuarioAutenticado,
    requisicao: Request,
    resposta: Response,
  ): Promise<void> {
    const conversa = await this.obterOuCriarConversa(pedido, usuario.id);
    const historico = await this.carregarHistorico(conversa.id);
    const ordemBase = await this.proximaOrdem(conversa.id);

    await this.mensagens.save(
      this.mensagens.create({
        conversa,
        ordem: ordemBase,
        papel: PapelMensagem.USUARIO,
        texto: pedido.pergunta,
      }),
    );

    const mensagemAssistente = await this.mensagens.save(
      this.mensagens.create({
        conversa,
        ordem: ordemBase + 1,
        papel: PapelMensagem.ASSISTENTE,
        texto: '',
      }),
    );

    resposta.writeHead(200, CABECALHOS_SSE);
    resposta.flushHeaders();
    requisicao.socket?.setNoDelay(true);

    const contexto: ContextoTurno = {
      perfilId: usuario.perfil.id,
      conversaId: conversa.id,
      usuarioId: usuario.id,
      escopo: pedido.escopo,
      historico,
    };

    await this.transmitirTurno(
      pedido.pergunta,
      contexto,
      mensagemAssistente,
      requisicao,
      resposta,
    );
  }

  private async transmitirTurno(
    pergunta: string,
    contexto: ContextoTurno,
    mensagemAssistente: Mensagem,
    requisicao: Request,
    resposta: Response,
  ): Promise<void> {
    const iterator = this.motor
      .responder(pergunta, contexto)
      [Symbol.asyncIterator]() as AsyncIterator<EventoOraculo, void>;

    const fechamento = new Promise<void>((resolve) => {
      requisicao.once('close', () => resolve());
    });

    let desconectado = false;
    let textoFinal = '';
    let tokensFinal: number | null = null;
    let duracaoFinal: number | null = null;
    let coberturaFinal: Cobertura | null = null;
    const fontesDoTurno: Fonte[] = [];
    const idsDeFonteVistos = new Set<string>();
    const ferramentasIniciadas = new Map<string, FerramentaIniciada>();
    let fontesDaFerramentaAtual: Fonte[] = [];

    try {
      while (true) {
        const proximo = await Promise.race([
          iterator
            .next()
            .then((resultado) => ({ tipo: 'evento' as const, resultado })),
          fechamento.then(() => ({ tipo: 'fechado' as const })),
        ]);

        if (proximo.tipo === 'fechado') {
          desconectado = true;
          await iterator.return?.(undefined);
          break;
        }

        const { done, value: evento } = proximo.resultado;

        if (done) {
          break;
        }

        resposta.write(serializarEvento(evento));

        switch (evento.tipo) {
          case 'texto.delta':
            textoFinal += evento.fragmento;
            break;

          case 'ferramenta.inicio':
            ferramentasIniciadas.set(evento.id, {
              nome: evento.nome,
              argumento: evento.argumento,
            });
            fontesDaFerramentaAtual = [];
            break;

          case 'citacao':
            fontesDaFerramentaAtual.push(evento.fonte);

            if (!idsDeFonteVistos.has(evento.fonte.id)) {
              idsDeFonteVistos.add(evento.fonte.id);
              fontesDoTurno.push(evento.fonte);
            }

            break;

          case 'ferramenta.fim': {
            const info = ferramentasIniciadas.get(evento.id);

            await this.ferramentas.save(
              this.ferramentas.create({
                mensagem: mensagemAssistente,
                nome: info?.nome ?? 'desconhecida',
                argumento: info ? { resumo: info.argumento } : null,
                status: evento.status as unknown as StatusFerramentaExecucao,
                metrica: { resumo: evento.metrica },
                duracaoMs: evento.duracaoMs,
                aprovadaPor: evento.aprovadaPor ?? null,
                resultado: {
                  resumo: evento.resultado,
                  fontes: fontesDaFerramentaAtual,
                },
              }),
            );
            fontesDaFerramentaAtual = [];
            break;
          }

          case 'aprovacao.pedido':
            await this.aprovacoes.save(
              this.aprovacoes.create({
                mensagem: mensagemAssistente,
                comando: evento.comando,
                alvo: evento.alvo,
                politica: evento.politica,
                expiraEm: new Date(evento.expiraEm),
                status: StatusAprovacao.PENDENTE,
              }),
            );
            break;

          case 'mensagem.fim':
            tokensFinal = evento.tokens;
            duracaoFinal = evento.duracaoMs;
            coberturaFinal = evento.cobertura;
            break;

          default:
            break;
        }
      }
    } catch (falha) {
      if (!desconectado) {
        resposta.write(
          serializarEvento({
            tipo: 'erro',
            codigo: 'falha_interna',
            mensagem: descreverFalha(falha),
            retomavel: false,
          }),
        );
      }
    } finally {
      const temCobertura = coberturaFinal !== null || fontesDoTurno.length > 0;

      mensagemAssistente.texto = textoFinal;
      mensagemAssistente.tokens = tokensFinal;
      mensagemAssistente.duracaoMs = duracaoFinal;
      mensagemAssistente.cobertura = temCobertura
        ? { ...(coberturaFinal ?? {}), fontes: fontesDoTurno }
        : null;

      await this.mensagens.save(mensagemAssistente);
      resposta.end();
    }
  }

  private async obterOuCriarConversa(
    pedido: PedidoChat,
    usuarioId: string,
  ): Promise<Conversa> {
    if (!pedido.conversaId) {
      return this.conversas.save(
        this.conversas.create({
          titulo: tituloDaConversa(pedido.pergunta),
          usuario: { id: usuarioId } as Usuario,
        }),
      );
    }

    const conversa = await this.conversas.findOne({
      where: { id: pedido.conversaId, usuario: { id: usuarioId } },
    });

    if (!conversa) {
      throw new NotFoundException('conversa não encontrada');
    }

    return conversa;
  }

  private async carregarHistorico(
    conversaId: string,
  ): Promise<MensagemTurno[]> {
    const mensagens = await this.mensagens.find({
      where: { conversa: { id: conversaId } },
      order: { ordem: 'ASC' },
    });

    return mensagens.map((mensagem) => ({
      papel:
        mensagem.papel === PapelMensagem.USUARIO ? 'usuario' : 'assistente',
      texto: mensagem.texto,
    }));
  }

  private async proximaOrdem(conversaId: string): Promise<number> {
    const ultima = await this.mensagens.findOne({
      where: { conversa: { id: conversaId } },
      order: { ordem: 'DESC' },
    });

    return ultima ? ultima.ordem + 1 : 0;
  }
}
