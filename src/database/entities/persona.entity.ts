import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Usuario } from './usuario.entity';

@Entity('persona')
export class Persona {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  texto: string;

  @UpdateDateColumn({ type: 'timestamptz', name: 'atualizada_em' })
  atualizadaEm: Date;

  @ManyToOne(() => Usuario, { nullable: true })
  @JoinColumn({ name: 'atualizada_por' })
  atualizadaPor: Usuario | null;
}
