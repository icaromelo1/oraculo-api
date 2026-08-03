import 'reflect-metadata';
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CorpusIndexModule } from './corpus-index.module';
import { IndexacaoService } from './indexacao.service';

async function bootstrap() {
  const logger = new Logger('CorpusIndex');
  const app = await NestFactory.createApplicationContext(CorpusIndexModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const indexacao = app.get(IndexacaoService);
    const resumo = await indexacao.executar();

    logger.log('resumo da indexação:');
    logger.log(`  documentos novos:        ${resumo.documentosNovos}`);
    logger.log(`  documentos atualizados:  ${resumo.documentosAtualizados}`);
    logger.log(`  documentos inalterados:  ${resumo.documentosInalterados}`);
    logger.log(`  trechos gerados:         ${resumo.trechosGerados}`);
    logger.log(`  recusados pela denylist: ${resumo.recusadosPelaDenylist}`);
    logger.log(`  tempo total:             ${resumo.duracaoMs}ms`);
  } finally {
    await app.close();
  }
}

bootstrap().catch((erro: unknown) => {
  new Logger('CorpusIndex').error(erro);
  process.exitCode = 1;
});
