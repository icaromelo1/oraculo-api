import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Usuario } from './usuario.entity';

export enum NomeCapacidadeInstalacao {
  CONHECIMENTO = 'conhecimento',
  CODIGO = 'codigo',
  ESTADO = 'estado',
  BANCO = 'banco',
}

@Entity('capacidade_instalacao')
export class CapacidadeInstalacao {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: NomeCapacidadeInstalacao,
    enumName: 'capacidade_instalacao_capacidade_enum',
    unique: true,
  })
  capacidade: NomeCapacidadeInstalacao;

  @Column({ type: 'boolean', default: false })
  ligada: boolean;

  @UpdateDateColumn({ type: 'timestamptz', name: 'atualizada_em' })
  atualizadaEm: Date;

  @ManyToOne(() => Usuario, { nullable: true })
  @JoinColumn({ name: 'atualizada_por' })
  atualizadaPor: Usuario | null;
}
