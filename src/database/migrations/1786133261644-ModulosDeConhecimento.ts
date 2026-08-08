import { MigrationInterface, QueryRunner } from 'typeorm';

export class ModulosDeConhecimento1786133261644 implements MigrationInterface {
  name = 'ModulosDeConhecimento1786133261644';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "modulo" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "nome" character varying NOT NULL, "descricao" text NOT NULL, "especialista_documento_id" uuid, "criado_em" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "criado_por" uuid, CONSTRAINT "UQ_c56cddcd0841bdd4eb2a85c4c0b" UNIQUE ("nome"), CONSTRAINT "PK_0b577bb28fdb8c35383e2c573ea" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`ALTER TABLE "documento" ADD "modulo_id" uuid`);
    await queryRunner.query(`ALTER TABLE "documento" ADD "descricao" text`);
    await queryRunner.query(
      `ALTER TABLE "modulo" ADD CONSTRAINT "FK_30039256b9b833da207f37eda17" FOREIGN KEY ("especialista_documento_id") REFERENCES "documento"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "modulo" ADD CONSTRAINT "FK_21bfd2fb650739afa7e6be811d6" FOREIGN KEY ("criado_por") REFERENCES "usuario"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "documento" ADD CONSTRAINT "FK_dd4aa3499a3e8b5d3a29bbff338" FOREIGN KEY ("modulo_id") REFERENCES "modulo"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "documento" DROP CONSTRAINT "FK_dd4aa3499a3e8b5d3a29bbff338"`,
    );
    await queryRunner.query(
      `ALTER TABLE "modulo" DROP CONSTRAINT "FK_21bfd2fb650739afa7e6be811d6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "modulo" DROP CONSTRAINT "FK_30039256b9b833da207f37eda17"`,
    );
    await queryRunner.query(`ALTER TABLE "documento" DROP COLUMN "descricao"`);
    await queryRunner.query(`ALTER TABLE "documento" DROP COLUMN "modulo_id"`);
    await queryRunner.query(`DROP TABLE "modulo"`);
  }
}
