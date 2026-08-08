import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Modulo } from './modulo.entity';
import { Usuario } from './usuario.entity';

export enum StatusProposta {
  PENDENTE = 'pendente',
  APROVADA = 'aprovada',
  DESCARTADA = 'descartada',
}

@Entity('proposta_conhecimento')
export class PropostaConhecimento {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  titulo: string;

  @Column({ type: 'text' })
  conteudo: string;

  @Column({ type: 'text' })
  justificativa: string;

  @Column({ type: 'varchar', name: 'origem_caminho', nullable: true })
  origemCaminho: string | null;

  @Column({ type: 'uuid', name: 'modulo_id', nullable: true })
  moduloId: string | null;

  @ManyToOne(() => Modulo, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'modulo_id' })
  modulo: Modulo | null;

  @Column({
    type: 'enum',
    enum: StatusProposta,
    enumName: 'proposta_conhecimento_status_enum',
    default: StatusProposta.PENDENTE,
  })
  status: StatusProposta;

  @CreateDateColumn({ type: 'timestamptz', name: 'criada_em' })
  criadaEm: Date;

  @Column({ type: 'timestamptz', name: 'decidida_em', nullable: true })
  decididaEm: Date | null;

  @Column({ type: 'uuid', name: 'decidida_por', nullable: true })
  decididaPorId: string | null;

  @ManyToOne(() => Usuario, { nullable: true })
  @JoinColumn({ name: 'decidida_por' })
  decididaPor: Usuario | null;

  @Column({ type: 'text', name: 'observacao_da_decisao', nullable: true })
  observacaoDaDecisao: string | null;
}
