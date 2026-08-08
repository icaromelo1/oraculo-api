import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfiguracaoModule } from '../config/configuracao.module';
import { Documento, ProvedorModelo } from '../database/entities';
import { criarLlmProviderDe } from '../providers/provider.factory';
import { SecurityModule } from '../security/security.module';
import { AmbienteController } from './ambiente.controller';
import { AmbienteService } from './ambiente.service';
import { ModulosController } from './modulos.controller';
import { ProvedoresController } from './provedores.controller';
import {
  FABRICA_DE_PROVEDOR,
  TesteDeProvedorService,
} from './teste-provedor.service';

@Module({
  imports: [
    ConfiguracaoModule,
    SecurityModule,
    TypeOrmModule.forFeature([Documento, ProvedorModelo]),
  ],
  controllers: [AmbienteController, ModulosController, ProvedoresController],
  providers: [
    AmbienteService,
    TesteDeProvedorService,
    { provide: FABRICA_DE_PROVEDOR, useValue: criarLlmProviderDe },
  ],
})
export class AmbienteModule {}
