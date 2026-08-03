import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Mensagem } from './mensagem.entity';

export enum StatusAprovacao {
  PENDENTE = 'pendente',
  APROVADA = 'aprovada',
  RECUSADA = 'recusada',
  EXPIRADA = 'expirada',
}

@Entity('aprovacao')
export class Aprovacao {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Mensagem, { nullable: false })
  @JoinColumn({ name: 'mensagem_id' })
  mensagem: Mensagem;

  @Column({ type: 'text' })
  comando: string;

  @Column({ type: 'varchar' })
  alvo: string;

  @Column({ type: 'varchar' })
  politica: string;

  @Column({ type: 'timestamptz', name: 'expira_em' })
  expiraEm: Date;

  @Column({
    type: 'enum',
    enum: StatusAprovacao,
    enumName: 'aprovacao_status_enum',
    default: StatusAprovacao.PENDENTE,
  })
  status: StatusAprovacao;

  @Column({ type: 'varchar', name: 'decidida_por', nullable: true })
  decididaPor: string | null;

  @Column({ type: 'timestamptz', name: 'decidida_em', nullable: true })
  decididaEm: Date | null;
}
