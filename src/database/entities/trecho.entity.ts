import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Documento } from './documento.entity';

@Entity('trecho')
export class Trecho {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Documento, { nullable: false })
  @JoinColumn({ name: 'documento_id' })
  documento: Documento;

  @Column({ type: 'integer' })
  ordem: number;

  @Column({ type: 'text' })
  texto: string;

  @Index('idx_trecho_busca', { type: 'gin' })
  @Column({
    type: 'tsvector',
    asExpression: "to_tsvector('portuguese', texto)",
    generatedType: 'STORED',
  })
  busca: string;

  @Column({ type: 'vector', length: 384, nullable: true })
  embedding: number[] | null;

  @Column({ type: 'integer', name: 'linha_inicio' })
  linhaInicio: number;

  @Column({ type: 'integer', name: 'linha_fim' })
  linhaFim: number;
}
