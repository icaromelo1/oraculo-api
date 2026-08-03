import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Usuario } from './usuario.entity';

@Entity('auditoria')
export class Auditoria {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Usuario, { nullable: true })
  @JoinColumn({ name: 'usuario_id' })
  usuario: Usuario | null;

  @Column({ type: 'text' })
  pergunta: string;

  @Column({ type: 'jsonb', nullable: true })
  ferramentas: Record<string, unknown> | null;

  @Column({ type: 'integer' })
  fontes: number;

  @Column({ type: 'text' })
  resultado: string;

  @Column({ type: 'varchar' })
  tom: string;

  @Column({ type: 'integer', name: 'duracao_ms' })
  duracaoMs: number;

  @Column({ type: 'varchar' })
  modelo: string;

  @Column({ type: 'jsonb', nullable: true })
  bloqueios: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'criada_em' })
  criadaEm: Date;
}
