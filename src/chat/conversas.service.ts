import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { Cobertura, Fonte } from '../contracts/eventos';
import {
  Aprovacao,
  Conversa,
  FerramentaExecucao,
  Mensagem,
  StatusFerramentaExecucao,
} from '../database/entities';

export interface ResumoConversa {
  id: string;
  titulo: string;
  hora: Date;
  fontes: number;
  ferramentas: number;
  aprovacoes: number;
  bloqueios: number;
}

export interface FerramentaDaMensagem {
  id: string;
  nome: string;
  status: StatusFerramentaExecucao;
  argumento: Record<string, unknown> | null;
  metrica: Record<string, unknown> | null;
  duracaoMs: number | null;
  aprovadaPor: string | null;
  resultado: Record<string, unknown> | null;
}

export interface MensagemDaConversa {
  id: string;
  papel: string;
  texto: string;
  ordem: number;
  criadaEm: Date;
  tokens: number | null;
  duracaoMs: number | null;
  cobertura: Cobertura | null;
  fontes: Fonte[];
  ferramentas: FerramentaDaMensagem[];
}

export interface ConversaCompleta {
  id: string;
  titulo: string;
  criadaEm: Date;
  atualizadaEm: Date;
  mensagens: MensagemDaConversa[];
}

@Injectable()
export class ConversasService {
  constructor(
    @InjectRepository(Conversa)
    private readonly conversas: Repository<Conversa>,
    @InjectRepository(Mensagem)
    private readonly mensagens: Repository<Mensagem>,
    @InjectRepository(FerramentaExecucao)
    private readonly ferramentas: Repository<FerramentaExecucao>,
    @InjectRepository(Aprovacao)
    private readonly aprovacoes: Repository<Aprovacao>,
  ) {}

  async listar(usuarioId: string): Promise<ResumoConversa[]> {
    const conversas = await this.conversas.find({
      where: { usuario: { id: usuarioId } },
    });

    const resumos = await Promise.all(
      conversas.map((conversa) => this.resumirConversa(conversa)),
    );

    return resumos.sort((a, b) => b.hora.getTime() - a.hora.getTime());
  }

  async obter(
    conversaId: string,
    usuarioId: string,
  ): Promise<ConversaCompleta> {
    const conversa = await this.conversas.findOne({
      where: { id: conversaId, usuario: { id: usuarioId } },
    });

    if (!conversa) {
      throw new NotFoundException('conversa não encontrada');
    }

    const mensagens = await this.mensagens.find({
      where: { conversa: { id: conversaId } },
      order: { ordem: 'ASC' },
    });

    const mensagemIds = mensagens.map((mensagem) => mensagem.id);
    const ferramentas = await this.ferramentasDasMensagens(mensagemIds);

    return {
      id: conversa.id,
      titulo: conversa.titulo,
      criadaEm: conversa.criadaEm,
      atualizadaEm: conversa.atualizadaEm,
      mensagens: mensagens.map((mensagem) => ({
        id: mensagem.id,
        papel: mensagem.papel,
        texto: mensagem.texto,
        ordem: mensagem.ordem,
        criadaEm: mensagem.criadaEm,
        tokens: mensagem.tokens,
        duracaoMs: mensagem.duracaoMs,
        cobertura: this.coberturaDaMensagem(mensagem),
        fontes: this.fontesDaMensagem(mensagem),
        ferramentas: ferramentas
          .filter((execucao) => execucao.mensagem.id === mensagem.id)
          .map((execucao) => ({
            id: execucao.id,
            nome: execucao.nome,
            status: execucao.status,
            argumento: execucao.argumento,
            metrica: execucao.metrica,
            duracaoMs: execucao.duracaoMs,
            aprovadaPor: execucao.aprovadaPor,
            resultado: execucao.resultado,
          })),
      })),
    };
  }

  private async resumirConversa(conversa: Conversa): Promise<ResumoConversa> {
    const mensagens = await this.mensagens.find({
      where: { conversa: { id: conversa.id } },
      order: { ordem: 'ASC' },
    });

    const mensagemIds = mensagens.map((mensagem) => mensagem.id);
    const [ferramentas, aprovacoes] = await Promise.all([
      this.ferramentasDasMensagens(mensagemIds),
      this.aprovacoesDasMensagens(mensagemIds),
    ]);

    const idsDeFonte = new Set<string>();

    for (const mensagem of mensagens) {
      for (const fonte of this.fontesDaMensagem(mensagem)) {
        idsDeFonte.add(fonte.id);
      }
    }

    const ultimaMensagem = mensagens[mensagens.length - 1];

    return {
      id: conversa.id,
      titulo: conversa.titulo,
      hora: ultimaMensagem ? ultimaMensagem.criadaEm : conversa.criadaEm,
      fontes: idsDeFonte.size,
      ferramentas: ferramentas.length,
      aprovacoes: aprovacoes.length,
      bloqueios: ferramentas.filter(
        (execucao) => execucao.status === StatusFerramentaExecucao.BLOQUEADA,
      ).length,
    };
  }

  private ferramentasDasMensagens(
    mensagemIds: string[],
  ): Promise<FerramentaExecucao[]> {
    if (mensagemIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.ferramentas.find({
      where: { mensagem: { id: In(mensagemIds) } },
      relations: { mensagem: true },
    });
  }

  private aprovacoesDasMensagens(mensagemIds: string[]): Promise<Aprovacao[]> {
    if (mensagemIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.aprovacoes.find({
      where: { mensagem: { id: In(mensagemIds) } },
      relations: { mensagem: true },
    });
  }

  private fontesDaMensagem(mensagem: Mensagem): Fonte[] {
    const fontes = mensagem.cobertura?.fontes;

    return Array.isArray(fontes) ? (fontes as Fonte[]) : [];
  }

  private coberturaDaMensagem(mensagem: Mensagem): Cobertura | null {
    if (!mensagem.cobertura) {
      return null;
    }

    const { citadas, total, semFonte } = mensagem.cobertura;

    if (
      typeof citadas !== 'number' ||
      typeof total !== 'number' ||
      typeof semFonte !== 'number'
    ) {
      return null;
    }

    return { citadas, total, semFonte };
  }
}
