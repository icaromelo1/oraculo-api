import { MigrationInterface, QueryRunner } from 'typeorm';

export class ProvedorModelo1786105101113 implements MigrationInterface {
  name = 'ProvedorModelo1786105101113';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."provedor_modelo_tipo_enum" AS ENUM('openai-compat', 'anthropic', 'cli')`,
    );
    await queryRunner.query(
      `CREATE TABLE "provedor_modelo" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "nome" character varying NOT NULL, "tipo" "public"."provedor_modelo_tipo_enum" NOT NULL, "base_url" character varying, "modelo" character varying, "chave_cifrada" character varying, "cabecalhos_extras" jsonb, "parametros" jsonb, "comando" character varying, "dialeto" character varying, "ativo" boolean NOT NULL DEFAULT false, "criado_em" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "criado_por" uuid, CONSTRAINT "UQ_6068532cd3b465ad721e337b937" UNIQUE ("nome"), CONSTRAINT "PK_84998af246925aecca3894ae82f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "provedor_modelo" ADD CONSTRAINT "FK_4e86b905a10d058982ea62046b3" FOREIGN KEY ("criado_por") REFERENCES "usuario"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "provedor_modelo" DROP CONSTRAINT "FK_4e86b905a10d058982ea62046b3"`,
    );
    await queryRunner.query(`DROP TABLE "provedor_modelo"`);
    await queryRunner.query(`DROP TYPE "public"."provedor_modelo_tipo_enum"`);
  }
}
