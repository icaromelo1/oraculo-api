import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Conversa } from './conversa.entity';

export enum PapelMensagem {
  USUARIO = 'usuario',
  ASSISTENTE = 'assistente',
}

@Entity('mensagem')
@Index('idx_mensagem_conversa_ordem', ['conversa', 'ordem'])
export class Mensagem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Conversa, { nullable: false })
  @JoinColumn({ name: 'conversa_id' })
  conversa: Conversa;

  @Column({ type: 'integer' })
  ordem: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'criada_em' })
  criadaEm: Date;

  @Column({
    type: 'enum',
    enum: PapelMensagem,
    enumName: 'mensagem_papel_enum',
  })
  papel: PapelMensagem;

  @Column({ type: 'text' })
  texto: string;

  @Column({ type: 'integer', nullable: true })
  tokens: number | null;

  @Column({ type: 'integer', name: 'duracao_ms', nullable: true })
  duracaoMs: number | null;

  @Column({ type: 'jsonb', nullable: true })
  cobertura: Record<string, unknown> | null;
}
