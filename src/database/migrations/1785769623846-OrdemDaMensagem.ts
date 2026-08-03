import { MigrationInterface, QueryRunner } from "typeorm";

export class OrdemDaMensagem1785769623846 implements MigrationInterface {
    name = 'OrdemDaMensagem1785769623846'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "mensagem" ADD "ordem" integer NOT NULL`);
        await queryRunner.query(`ALTER TABLE "mensagem" ADD "criada_em" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`);
        await queryRunner.query(`ALTER TYPE "public"."mensagem_papel_enum" RENAME TO "mensagem_papel_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."mensagem_papel_enum" AS ENUM('usuario', 'assistente')`);
        await queryRunner.query(`ALTER TABLE "mensagem" ALTER COLUMN "papel" TYPE "public"."mensagem_papel_enum" USING "papel"::"text"::"public"."mensagem_papel_enum"`);
        await queryRunner.query(`DROP TYPE "public"."mensagem_papel_enum_old"`);
        await queryRunner.query(`ALTER TYPE "public"."aprovacao_status_enum" RENAME TO "aprovacao_status_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."aprovacao_status_enum" AS ENUM('pendente', 'aprovada', 'recusada', 'expirada')`);
        await queryRunner.query(`ALTER TABLE "aprovacao" ALTER COLUMN "status" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "aprovacao" ALTER COLUMN "status" TYPE "public"."aprovacao_status_enum" USING "status"::"text"::"public"."aprovacao_status_enum"`);
        await queryRunner.query(`ALTER TABLE "aprovacao" ALTER COLUMN "status" SET DEFAULT 'pendente'`);
        await queryRunner.query(`DROP TYPE "public"."aprovacao_status_enum_old"`);
        await queryRunner.query(`ALTER TYPE "public"."ferramenta_execucao_status_enum" RENAME TO "ferramenta_execucao_status_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."ferramenta_execucao_status_enum" AS ENUM('concluida', 'executando', 'na_fila', 'bloqueada', 'erro')`);
        await queryRunner.query(`ALTER TABLE "ferramenta_execucao" ALTER COLUMN "status" TYPE "public"."ferramenta_execucao_status_enum" USING "status"::"text"::"public"."ferramenta_execucao_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."ferramenta_execucao_status_enum_old"`);
        await queryRunner.query(`ALTER TYPE "public"."perfil_capacidade_status_enum" RENAME TO "perfil_capacidade_status_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."perfil_capacidade_status_enum" AS ENUM('permitida', 'aprovacao', 'negada')`);
        await queryRunner.query(`ALTER TABLE "perfil_capacidade" ALTER COLUMN "status" TYPE "public"."perfil_capacidade_status_enum" USING "status"::"text"::"public"."perfil_capacidade_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."perfil_capacidade_status_enum_old"`);
        await queryRunner.query(`CREATE INDEX "idx_mensagem_conversa_ordem" ON "mensagem"  ("conversa_id", "ordem") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."idx_mensagem_conversa_ordem"`);
        await queryRunner.query(`CREATE TYPE "public"."perfil_capacidade_status_enum_old" AS ENUM('permitida', 'aprovacao', 'negada')`);
        await queryRunner.query(`ALTER TABLE "perfil_capacidade" ALTER COLUMN "status" TYPE "public"."perfil_capacidade_status_enum_old" USING "status"::"text"::"public"."perfil_capacidade_status_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."perfil_capacidade_status_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."perfil_capacidade_status_enum_old" RENAME TO "perfil_capacidade_status_enum"`);
        await queryRunner.query(`CREATE TYPE "public"."ferramenta_execucao_status_enum_old" AS ENUM('concluida', 'executando', 'na_fila', 'bloqueada', 'erro')`);
        await queryRunner.query(`ALTER TABLE "ferramenta_execucao" ALTER COLUMN "status" TYPE "public"."ferramenta_execucao_status_enum_old" USING "status"::"text"::"public"."ferramenta_execucao_status_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."ferramenta_execucao_status_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."ferramenta_execucao_status_enum_old" RENAME TO "ferramenta_execucao_status_enum"`);
        await queryRunner.query(`CREATE TYPE "public"."aprovacao_status_enum_old" AS ENUM('pendente', 'aprovada', 'recusada', 'expirada')`);
        await queryRunner.query(`ALTER TABLE "aprovacao" ALTER COLUMN "status" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "aprovacao" ALTER COLUMN "status" TYPE "public"."aprovacao_status_enum_old" USING "status"::"text"::"public"."aprovacao_status_enum_old"`);
        await queryRunner.query(`ALTER TABLE "aprovacao" ALTER COLUMN "status" SET DEFAULT 'pendente'`);
        await queryRunner.query(`DROP TYPE "public"."aprovacao_status_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."aprovacao_status_enum_old" RENAME TO "aprovacao_status_enum"`);
        await queryRunner.query(`CREATE TYPE "public"."mensagem_papel_enum_old" AS ENUM('usuario', 'assistente')`);
        await queryRunner.query(`ALTER TABLE "mensagem" ALTER COLUMN "papel" TYPE "public"."mensagem_papel_enum_old" USING "papel"::"text"::"public"."mensagem_papel_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."mensagem_papel_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."mensagem_papel_enum_old" RENAME TO "mensagem_papel_enum"`);
        await queryRunner.query(`ALTER TABLE "mensagem" DROP COLUMN "criada_em"`);
        await queryRunner.query(`ALTER TABLE "mensagem" DROP COLUMN "ordem"`);
    }

}
