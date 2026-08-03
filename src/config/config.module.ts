import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OraculoConfig } from './config.service';
import { validarEnv } from './env.schema';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validarEnv,
    }),
  ],
  providers: [OraculoConfig],
  exports: [OraculoConfig],
})
export class OraculoConfigModule {}
