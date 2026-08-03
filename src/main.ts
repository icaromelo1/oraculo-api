import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { OraculoConfig } from './config/config.service';

async function bootstrap() {
  const logger = new Logger('Oraculo');
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks();

  const config = app.get(OraculoConfig);
  await app.listen(config.porta);

  logger.log(
    `no ar em :${config.porta} · provedor ${config.provedor.tipo} · recuperação ${config.recuperacao.modo}`,
  );
}

void bootstrap();
