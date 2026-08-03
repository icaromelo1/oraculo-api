import { Injectable } from '@nestjs/common';
import { Auditoria } from '../database/entities';
import { AuditoriaRegistroService } from './auditoria-registro.service';
import { EnvelopeService } from './envelope.service';
import { PoliticaService } from './politica.service';
import { RedactionService } from './redaction.service';
import type {
  AlcancePerfil,
  PedidoFerramenta,
  RegistroTurno,
  ResultadoRedacao,
  RetornoFerramenta,
  RetornoProtegido,
  Veredito,
} from './tipos';

@Injectable()
export class SecurityService {
  constructor(
    private readonly politica: PoliticaService,
    private readonly redacao: RedactionService,
    private readonly envelope: EnvelopeService,
    private readonly auditoria: AuditoriaRegistroService,
  ) {}

  async avaliarPedido(pedido: PedidoFerramenta): Promise<Veredito> {
    const veredito = this.politica.avaliar(pedido);

    if (veredito.decisao !== 'permitir') {
      await this.auditoria.registrarBloqueio({
        usuarioId: pedido.usuarioId,
        pergunta: pedido.pergunta,
        modelo: pedido.modelo,
        bloqueio: {
          capacidade: veredito.capacidade,
          decisao: veredito.decisao,
          politica: veredito.politica,
          motivo: veredito.motivo,
          argumento: pedido.argumentos,
        },
      });
    }

    return veredito;
  }

  protegerRetorno(retorno: RetornoFerramenta): RetornoProtegido {
    const redacao = this.redacao.redigir(retorno.conteudo);

    return {
      texto: this.envelope.envelopar({
        origem: retorno.origem,
        conteudo: redacao.texto,
        truncado: retorno.truncado,
      }),
      redacao,
    };
  }

  protegerSaida(texto: string): ResultadoRedacao {
    return this.redacao.redigir(texto);
  }

  registrar(registro: RegistroTurno): Promise<Auditoria | null> {
    return this.auditoria.registrarTurno(registro);
  }

  carregarAlcance(perfilId: string): Promise<AlcancePerfil> {
    return this.politica.carregarAlcance(perfilId);
  }

  instrucaoDeSistema(): string {
    return this.envelope.instrucaoDeSistema();
  }
}
