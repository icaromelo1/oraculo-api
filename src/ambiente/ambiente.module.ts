import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfiguracaoModule } from '../config/configuracao.module';
import { Documento } from '../database/entities';
import { AmbienteController } from './ambiente.controller';
import { AmbienteService } from './ambiente.service';

@Module({
  imports: [ConfiguracaoModule, TypeOrmModule.forFeature([Documento])],
  controllers: [AmbienteController],
  providers: [AmbienteService],
})
export class AmbienteModule {}
