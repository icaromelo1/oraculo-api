import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConfiguracaoDinamica1785873125740 implements MigrationInterface {
  name = 'ConfiguracaoDinamica1785873125740';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "alvo_banco" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "nome" character varying NOT NULL, "url" text NOT NULL, "schemas" jsonb NOT NULL DEFAULT '[]'::jsonb, "colunas_mascaradas" jsonb NOT NULL DEFAULT '[]'::jsonb, "ativo" boolean NOT NULL DEFAULT true, "criado_em" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_d2f48c9a7028bba3429b16fb6bb" UNIQUE ("nome"), CONSTRAINT "PK_567d65cc5af8da246c912f9bef3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."capacidade_instalacao_capacidade_enum" AS ENUM('conhecimento', 'codigo', 'estado', 'banco')`,
    );
    await queryRunner.query(
      `CREATE TABLE "capacidade_instalacao" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "capacidade" "public"."capacidade_instalacao_capacidade_enum" NOT NULL, "ligada" boolean NOT NULL DEFAULT false, "atualizada_em" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "atualizada_por" uuid, CONSTRAINT "UQ_c1fc7a37d905582a8e26818ff5f" UNIQUE ("capacidade"), CONSTRAINT "PK_8fb9d864f1b92d3a9b08ba082dd" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "fonte_conhecimento" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "caminho" character varying NOT NULL, "rotulo" character varying NOT NULL, "ativa" boolean NOT NULL DEFAULT true, "criada_em" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "criada_por" uuid, CONSTRAINT "UQ_6927a684f8f809d308f3ea8e8bb" UNIQUE ("caminho"), CONSTRAINT "PK_d5ec6ebe7d03122ddf64c42661f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "servico_observavel" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "nome" character varying NOT NULL, "rotulo" character varying NOT NULL, "ativo" boolean NOT NULL DEFAULT true, "criado_em" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_69309a881f1960c95ca3c2da5b9" UNIQUE ("nome"), CONSTRAINT "PK_2fba5b4685dd95e49bd3b253eba" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_auditoria_usuario_criada_em" ON "auditoria"  ("usuario_id", "criada_em") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_auditoria_criada_em" ON "auditoria"  ("criada_em") `,
    );
    await queryRunner.query(
      `ALTER TABLE "capacidade_instalacao" ADD CONSTRAINT "FK_a4f8f576093a23e462a2867ce13" FOREIGN KEY ("atualizada_por") REFERENCES "usuario"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "fonte_conhecimento" ADD CONSTRAINT "FK_81ef2abb77cfa286ec55c8abab0" FOREIGN KEY ("criada_por") REFERENCES "usuario"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "fonte_conhecimento" DROP CONSTRAINT "FK_81ef2abb77cfa286ec55c8abab0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "capacidade_instalacao" DROP CONSTRAINT "FK_a4f8f576093a23e462a2867ce13"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_auditoria_criada_em"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_auditoria_usuario_criada_em"`,
    );
    await queryRunner.query(`DROP TABLE "servico_observavel"`);
    await queryRunner.query(`DROP TABLE "fonte_conhecimento"`);
    await queryRunner.query(`DROP TABLE "capacidade_instalacao"`);
    await queryRunner.query(
      `DROP TYPE "public"."capacidade_instalacao_capacidade_enum"`,
    );
    await queryRunner.query(`DROP TABLE "alvo_banco"`);
  }
}
