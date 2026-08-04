import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AlvoBanco,
  CapacidadeInstalacao,
  FonteConhecimento,
  ServicoObservavel,
} from '../database/entities';
import { SecurityModule } from '../security/security.module';
import { CifraService } from './cifra.service';
import { ConfiguracaoService } from './configuracao.service';

@Global()
@Module({
  imports: [
    SecurityModule,
    TypeOrmModule.forFeature([
      CapacidadeInstalacao,
      FonteConhecimento,
      AlvoBanco,
      ServicoObservavel,
    ]),
  ],
  providers: [CifraService, ConfiguracaoService],
  exports: [CifraService, ConfiguracaoService],
})
export class ConfiguracaoModule {}
