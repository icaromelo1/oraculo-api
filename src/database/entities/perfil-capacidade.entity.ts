import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Perfil } from './perfil.entity';

export enum StatusPerfilCapacidade {
  PERMITIDA = 'permitida',
  APROVACAO = 'aprovacao',
  NEGADA = 'negada',
}

@Entity('perfil_capacidade')
export class PerfilCapacidade {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Perfil, { nullable: false })
  @JoinColumn({ name: 'perfil_id' })
  perfil: Perfil;

  @Column({ type: 'varchar' })
  capacidade: string;

  @Column({
    type: 'enum',
    enum: StatusPerfilCapacidade,
    enumName: 'perfil_capacidade_status_enum',
  })
  status: StatusPerfilCapacidade;

  @Column({ type: 'jsonb', nullable: true })
  escopo: Record<string, unknown> | null;
}
