import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Perfil } from './perfil.entity';

@Entity('usuario')
export class Usuario {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  login: string;

  @Column({ type: 'varchar', name: 'senha_hash' })
  senhaHash: string;

  @Column({ type: 'varchar' })
  nome: string;

  @Column({ type: 'boolean', default: true })
  ativo: boolean;

  @ManyToOne(() => Perfil, { nullable: false })
  @JoinColumn({ name: 'perfil_id' })
  perfil: Perfil;
}
