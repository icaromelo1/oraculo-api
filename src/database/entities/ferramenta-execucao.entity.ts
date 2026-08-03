import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Mensagem } from './mensagem.entity';

export enum StatusFerramentaExecucao {
  CONCLUIDA = 'concluida',
  EXECUTANDO = 'executando',
  NA_FILA = 'na_fila',
  BLOQUEADA = 'bloqueada',
  ERRO = 'erro',
}

@Entity('ferramenta_execucao')
export class FerramentaExecucao {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Mensagem, { nullable: false })
  @JoinColumn({ name: 'mensagem_id' })
  mensagem: Mensagem;

  @Column({ type: 'varchar' })
  nome: string;

  @Column({ type: 'jsonb', nullable: true })
  argumento: Record<string, unknown> | null;

  @Column({
    type: 'enum',
    enum: StatusFerramentaExecucao,
    enumName: 'ferramenta_execucao_status_enum',
  })
  status: StatusFerramentaExecucao;

  @Column({ type: 'jsonb', nullable: true })
  metrica: Record<string, unknown> | null;

  @Column({ type: 'integer', name: 'duracao_ms', nullable: true })
  duracaoMs: number | null;

  @Column({ type: 'varchar', name: 'aprovada_por', nullable: true })
  aprovadaPor: string | null;

  @Column({ type: 'jsonb', nullable: true })
  resultado: Record<string, unknown> | null;
}
