import { MigrationInterface, QueryRunner } from 'typeorm';

export class PersonaDaInstalacao1786148950418 implements MigrationInterface {
  name = 'PersonaDaInstalacao1786148950418';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "persona" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "texto" text NOT NULL, "atualizada_em" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "atualizada_por" uuid, CONSTRAINT "PK_2a4e1f4b1f5b6f6e0d8a3b1c9d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "persona" ADD CONSTRAINT "FK_5c8b7a1d3e2f4a6b8c0d1e2f3a" FOREIGN KEY ("atualizada_por") REFERENCES "usuario"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "persona" DROP CONSTRAINT "FK_5c8b7a1d3e2f4a6b8c0d1e2f3a"`,
    );
    await queryRunner.query(`DROP TABLE "persona"`);
  }
}
