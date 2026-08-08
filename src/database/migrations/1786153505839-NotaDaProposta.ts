import { MigrationInterface, QueryRunner } from 'typeorm';

export class NotaDaProposta1786153505839 implements MigrationInterface {
  name = 'NotaDaProposta1786153505839';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "proposta_conhecimento" ADD "nota_slug" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "proposta_conhecimento" DROP COLUMN "nota_slug"`,
    );
  }
}
