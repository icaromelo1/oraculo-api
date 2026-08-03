import { MigrationInterface, QueryRunner } from 'typeorm';

export class InicialSchema1785769323459 implements MigrationInterface {
  name = 'InicialSchema1785769323459';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "vector"`);
    await queryRunner.query(
      `CREATE TABLE "perfil" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "nome" character varying NOT NULL, "descricao" text, CONSTRAINT "UQ_ad304e9e7916b226cbec3dbcd31" UNIQUE ("nome"), CONSTRAINT "PK_814c50101bf1675e1f691aad2c9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "usuario" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "login" character varying NOT NULL, "senha_hash" character varying NOT NULL, "nome" character varying NOT NULL, "ativo" boolean NOT NULL DEFAULT true, "perfil_id" uuid NOT NULL, CONSTRAINT "UQ_59bc805e13413e4be83be3a7752" UNIQUE ("login"), CONSTRAINT "PK_a56c58e5cabaa04fb2c98d2d7e2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "conversa" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "titulo" character varying NOT NULL, "criada_em" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "atualizada_em" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "usuario_id" uuid NOT NULL, CONSTRAINT "PK_279ba6bef85458955dffef458d7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."mensagem_papel_enum" AS ENUM('usuario', 'assistente')`,
    );
    await queryRunner.query(
      `CREATE TABLE "mensagem" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "papel" "public"."mensagem_papel_enum" NOT NULL, "texto" text NOT NULL, "tokens" integer, "duracao_ms" integer, "cobertura" jsonb, "conversa_id" uuid NOT NULL, CONSTRAINT "PK_d9d31c3c3a8a1136d07bf8733c1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."aprovacao_status_enum" AS ENUM('pendente', 'aprovada', 'recusada', 'expirada')`,
    );
    await queryRunner.query(
      `CREATE TABLE "aprovacao" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "comando" text NOT NULL, "alvo" character varying NOT NULL, "politica" character varying NOT NULL, "expira_em" TIMESTAMP WITH TIME ZONE NOT NULL, "status" "public"."aprovacao_status_enum" NOT NULL DEFAULT 'pendente', "decidida_por" character varying, "decidida_em" TIMESTAMP WITH TIME ZONE, "mensagem_id" uuid NOT NULL, CONSTRAINT "PK_e6bd5d27d265ae88f0500b398d2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "auditoria" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "pergunta" text NOT NULL, "ferramentas" jsonb, "fontes" integer NOT NULL, "resultado" text NOT NULL, "tom" character varying NOT NULL, "duracao_ms" integer NOT NULL, "modelo" character varying NOT NULL, "bloqueios" jsonb, "criada_em" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "usuario_id" uuid, CONSTRAINT "PK_135fe98308816fe3a2d458e6637" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "documento" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "caminho" character varying NOT NULL, "fonte" character varying NOT NULL, "autoridade" smallint NOT NULL, "titulo" character varying NOT NULL, "hash" character varying NOT NULL, "atualizado_em" TIMESTAMP WITH TIME ZONE NOT NULL, "meta" jsonb, CONSTRAINT "UQ_82b75bc22558d49472bb4d5d139" UNIQUE ("caminho"), CONSTRAINT "CHK_8d4d9683a1068aa9bb45b5c69c" CHECK ("autoridade" >= 1 AND "autoridade" <= 4), CONSTRAINT "PK_14a00534ba5a1136f420342c965" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."ferramenta_execucao_status_enum" AS ENUM('concluida', 'executando', 'na_fila', 'bloqueada', 'erro')`,
    );
    await queryRunner.query(
      `CREATE TABLE "ferramenta_execucao" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "nome" character varying NOT NULL, "argumento" jsonb, "status" "public"."ferramenta_execucao_status_enum" NOT NULL, "metrica" jsonb, "duracao_ms" integer, "aprovada_por" character varying, "resultado" jsonb, "mensagem_id" uuid NOT NULL, CONSTRAINT "PK_109050a8c0fad04a79248edf431" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."perfil_capacidade_status_enum" AS ENUM('permitida', 'aprovacao', 'negada')`,
    );
    await queryRunner.query(
      `CREATE TABLE "perfil_capacidade" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "capacidade" character varying NOT NULL, "status" "public"."perfil_capacidade_status_enum" NOT NULL, "escopo" jsonb, "perfil_id" uuid NOT NULL, CONSTRAINT "PK_c0958ae9ab670d6e8b577177168" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `INSERT INTO "typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        'oraculo',
        'public',
        'trecho',
        'GENERATED_COLUMN',
        'busca',
        "to_tsvector('portuguese', texto)",
      ],
    );
    await queryRunner.query(
      `CREATE TABLE "trecho" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "ordem" integer NOT NULL, "texto" text NOT NULL, "busca" tsvector GENERATED ALWAYS AS (to_tsvector('portuguese', texto)) STORED NOT NULL, "embedding" vector(384), "linha_inicio" integer NOT NULL, "linha_fim" integer NOT NULL, "documento_id" uuid NOT NULL, CONSTRAINT "PK_bafab05a60700cf33af72ccf96b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_trecho_busca" ON "trecho" USING gin ("busca") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_trecho_embedding" ON "trecho" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "usuario" ADD CONSTRAINT "FK_5d6ad913011b3de9d0059fe64b8" FOREIGN KEY ("perfil_id") REFERENCES "perfil"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversa" ADD CONSTRAINT "FK_99817d018557ca7aff87cee563e" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "mensagem" ADD CONSTRAINT "FK_31d5734403501aa6b706a074474" FOREIGN KEY ("conversa_id") REFERENCES "conversa"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "aprovacao" ADD CONSTRAINT "FK_7675c51969130a94f6be39eed8a" FOREIGN KEY ("mensagem_id") REFERENCES "mensagem"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "auditoria" ADD CONSTRAINT "FK_e3351946be53c7cd3286ed4c49d" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ferramenta_execucao" ADD CONSTRAINT "FK_1c1c29cfa8671e89dd415256f39" FOREIGN KEY ("mensagem_id") REFERENCES "mensagem"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "perfil_capacidade" ADD CONSTRAINT "FK_59a9ea5b8103dbd55480969a11b" FOREIGN KEY ("perfil_id") REFERENCES "perfil"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "trecho" ADD CONSTRAINT "FK_6c6ab526940aad4f12c1b58f8ff" FOREIGN KEY ("documento_id") REFERENCES "documento"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trecho" DROP CONSTRAINT "FK_6c6ab526940aad4f12c1b58f8ff"`,
    );
    await queryRunner.query(
      `ALTER TABLE "perfil_capacidade" DROP CONSTRAINT "FK_59a9ea5b8103dbd55480969a11b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ferramenta_execucao" DROP CONSTRAINT "FK_1c1c29cfa8671e89dd415256f39"`,
    );
    await queryRunner.query(
      `ALTER TABLE "auditoria" DROP CONSTRAINT "FK_e3351946be53c7cd3286ed4c49d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "aprovacao" DROP CONSTRAINT "FK_7675c51969130a94f6be39eed8a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "mensagem" DROP CONSTRAINT "FK_31d5734403501aa6b706a074474"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversa" DROP CONSTRAINT "FK_99817d018557ca7aff87cee563e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "usuario" DROP CONSTRAINT "FK_5d6ad913011b3de9d0059fe64b8"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_trecho_embedding"`);
    await queryRunner.query(`DROP INDEX "public"."idx_trecho_busca"`);
    await queryRunner.query(`DROP TABLE "trecho"`);
    await queryRunner.query(
      `DELETE FROM "typeorm_metadata" WHERE "type" = $1 AND "name" = $2 AND "database" = $3 AND "schema" = $4 AND "table" = $5`,
      ['GENERATED_COLUMN', 'busca', 'oraculo', 'public', 'trecho'],
    );
    await queryRunner.query(`DROP TABLE "perfil_capacidade"`);
    await queryRunner.query(
      `DROP TYPE "public"."perfil_capacidade_status_enum"`,
    );
    await queryRunner.query(`DROP TABLE "ferramenta_execucao"`);
    await queryRunner.query(
      `DROP TYPE "public"."ferramenta_execucao_status_enum"`,
    );
    await queryRunner.query(`DROP TABLE "documento"`);
    await queryRunner.query(`DROP TABLE "auditoria"`);
    await queryRunner.query(`DROP TABLE "aprovacao"`);
    await queryRunner.query(`DROP TYPE "public"."aprovacao_status_enum"`);
    await queryRunner.query(`DROP TABLE "mensagem"`);
    await queryRunner.query(`DROP TYPE "public"."mensagem_papel_enum"`);
    await queryRunner.query(`DROP TABLE "conversa"`);
    await queryRunner.query(`DROP TABLE "usuario"`);
    await queryRunner.query(`DROP TABLE "perfil"`);
  }
}
