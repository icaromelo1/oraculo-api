import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Usuario } from './usuario.entity';

export enum TipoProvedorModelo {
  OPENAI_COMPAT = 'openai-compat',
  ANTHROPIC = 'anthropic',
  CLI = 'cli',
}

@Entity('provedor_modelo')
export class ProvedorModelo {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  nome: string;

  @Column({
    type: 'enum',
    enum: TipoProvedorModelo,
    enumName: 'provedor_modelo_tipo_enum',
  })
  tipo: TipoProvedorModelo;

  @Column({ type: 'varchar', name: 'base_url', nullable: true })
  baseUrl: string | null;

  @Column({ type: 'varchar', nullable: true })
  modelo: string | null;

  @Column({ type: 'varchar', name: 'chave_cifrada', nullable: true })
  chaveCifrada: string | null;

  @Column({ type: 'jsonb', name: 'cabecalhos_extras', nullable: true })
  cabecalhosExtras: Record<string, string> | null;

  @Column({ type: 'jsonb', nullable: true })
  parametros: Record<string, unknown> | null;

  @Column({ type: 'varchar', nullable: true })
  comando: string | null;

  @Column({ type: 'varchar', nullable: true })
  dialeto: string | null;

  @Column({ type: 'boolean', default: false })
  ativo: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'criado_em' })
  criadoEm: Date;

  @ManyToOne(() => Usuario, { nullable: true })
  @JoinColumn({ name: 'criado_por' })
  criadoPor: Usuario | null;
}
