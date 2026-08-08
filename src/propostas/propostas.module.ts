import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ConfiguracaoModule } from '../config/configuracao.module';
import { ConhecimentoModule } from '../conhecimento/conhecimento.module';
import { PropostaConhecimento } from '../database/entities';
import { SecurityModule } from '../security/security.module';
import { PropostasController } from './propostas.controller';
import { PropostasService } from './propostas.service';

@Module({
  imports: [
    AuthModule,
    ConfiguracaoModule,
    ConhecimentoModule,
    SecurityModule,
    TypeOrmModule.forFeature([PropostaConhecimento]),
  ],
  controllers: [PropostasController],
  providers: [PropostasService],
  exports: [PropostasService],
})
export class PropostasModule {}
