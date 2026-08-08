import { MigrationInterface, QueryRunner } from 'typeorm';

export class PropostasDeConhecimento1786148911923 implements MigrationInterface {
  name = 'PropostasDeConhecimento1786148911923';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."proposta_conhecimento_status_enum" AS ENUM('pendente', 'aprovada', 'descartada')`,
    );
    await queryRunner.query(
      `CREATE TABLE "proposta_conhecimento" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "titulo" character varying NOT NULL, "conteudo" text NOT NULL, "justificativa" text NOT NULL, "origem_caminho" character varying, "modulo_id" uuid, "status" "public"."proposta_conhecimento_status_enum" NOT NULL DEFAULT 'pendente', "criada_em" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "decidida_em" TIMESTAMP WITH TIME ZONE, "decidida_por" uuid, "observacao_da_decisao" text, CONSTRAINT "PK_77f0de3d4954fec0ccaf662ddac" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "proposta_conhecimento" ADD CONSTRAINT "FK_bec1c8e78b4199f11315cf3d1ea" FOREIGN KEY ("modulo_id") REFERENCES "modulo"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "proposta_conhecimento" ADD CONSTRAINT "FK_d9fd8fe9f0322d0704e7def3ec7" FOREIGN KEY ("decidida_por") REFERENCES "usuario"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "proposta_conhecimento" DROP CONSTRAINT "FK_d9fd8fe9f0322d0704e7def3ec7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "proposta_conhecimento" DROP CONSTRAINT "FK_bec1c8e78b4199f11315cf3d1ea"`,
    );
    await queryRunner.query(`DROP TABLE "proposta_conhecimento"`);
    await queryRunner.query(
      `DROP TYPE "public"."proposta_conhecimento_status_enum"`,
    );
  }
}
