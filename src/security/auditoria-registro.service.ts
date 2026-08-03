import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Auditoria, Usuario } from '../database/entities';
import type { RegistroBloqueio, RegistroTurno } from './tipos';

const SEM_PERGUNTA = '(pedido do modelo, sem pergunta associada)';
const SEM_MODELO = '(nao aplicavel)';

@Injectable()
export class AuditoriaRegistroService {
  private readonly logger = new Logger(AuditoriaRegistroService.name);

  constructor(
    @InjectRepository(Auditoria)
    private readonly repositorio: Repository<Auditoria>,
  ) {}

  async registrarTurno(registro: RegistroTurno): Promise<Auditoria | null> {
    const bloqueios = registro.bloqueios ?? [];

    return this.gravar({
      usuario: this.referenciaUsuario(registro.usuarioId),
      pergunta: registro.pergunta,
      ferramentas: { itens: registro.ferramentas ?? [] },
      fontes: registro.fontes ?? 0,
      resultado: registro.resultado,
      tom: registro.tom ?? (bloqueios.length ? 'bloqueio_parcial' : 'normal'),
      duracaoMs: registro.duracaoMs,
      modelo: registro.modelo,
      bloqueios: { itens: bloqueios },
    });
  }

  async registrarBloqueio(
    registro: RegistroBloqueio,
  ): Promise<Auditoria | null> {
    return this.gravar({
      usuario: this.referenciaUsuario(registro.usuarioId),
      pergunta: registro.pergunta ?? SEM_PERGUNTA,
      ferramentas: { itens: [] },
      fontes: 0,
      resultado: `${registro.bloqueio.decisao}: ${registro.bloqueio.motivo}`,
      tom:
        registro.bloqueio.decisao === 'bloquear'
          ? 'bloqueio'
          : 'aprovacao_exigida',
      duracaoMs: 0,
      modelo: registro.modelo ?? SEM_MODELO,
      bloqueios: { itens: [registro.bloqueio] },
    });
  }

  private async gravar(dados: Partial<Auditoria>): Promise<Auditoria | null> {
    try {
      return await this.repositorio.save(this.repositorio.create(dados));
    } catch (erro) {
      this.logger.error(
        `falha ao gravar auditoria: ${erro instanceof Error ? erro.message : String(erro)}`,
      );

      return null;
    }
  }

  private referenciaUsuario(id?: string | null): Usuario | null {
    return id ? ({ id } as Usuario) : null;
  }
}
