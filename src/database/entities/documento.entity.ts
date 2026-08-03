import { Check, Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('documento')
@Check('"autoridade" >= 1 AND "autoridade" <= 4')
export class Documento {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  caminho: string;

  @Column({ type: 'varchar' })
  fonte: string;

  @Column({ type: 'smallint' })
  autoridade: number;

  @Column({ type: 'varchar' })
  titulo: string;

  @Column({ type: 'varchar' })
  hash: string;

  @Column({ type: 'timestamptz', name: 'atualizado_em' })
  atualizadoEm: Date;

  @Column({ type: 'jsonb', nullable: true })
  meta: Record<string, unknown> | null;
}
