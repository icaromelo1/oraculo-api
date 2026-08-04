import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('alvo_banco')
export class AlvoBanco {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  nome: string;

  @Column({ type: 'text' })
  url: string;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  schemas: string[];

  @Column({
    type: 'jsonb',
    name: 'colunas_mascaradas',
    default: () => "'[]'::jsonb",
  })
  colunasMascaradas: string[];

  @Column({ type: 'boolean', default: true })
  ativo: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'criado_em' })
  criadoEm: Date;
}
