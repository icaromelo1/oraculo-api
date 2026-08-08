import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Documento } from './documento.entity';
import { Usuario } from './usuario.entity';

@Entity('modulo')
export class Modulo {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  nome: string;

  @Column({ type: 'text' })
  descricao: string;

  @Column({ type: 'uuid', name: 'especialista_documento_id', nullable: true })
  especialistaDocumentoId: string | null;

  @ManyToOne(() => Documento, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'especialista_documento_id' })
  especialistaDocumento: Documento | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'criado_em' })
  criadoEm: Date;

  @ManyToOne(() => Usuario, { nullable: true })
  @JoinColumn({ name: 'criado_por' })
  criadoPor: Usuario | null;
}
