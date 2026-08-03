import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Aprovacao, Auditoria } from '../database/entities';
import { AuditoriaAcessoGuard } from './auditoria-acesso.guard';
import { AuditoriaController } from './auditoria.controller';
import { AuditoriaService } from './auditoria.service';

@Module({
  imports: [TypeOrmModule.forFeature([Auditoria, Aprovacao])],
  controllers: [AuditoriaController],
  providers: [AuditoriaService, AuditoriaAcessoGuard],
})
export class AuditoriaModule {}
