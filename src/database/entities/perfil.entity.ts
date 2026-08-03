import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('perfil')
export class Perfil {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  nome: string;

  @Column({ type: 'text', nullable: true })
  descricao: string | null;
}
