import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '../database/database.module';
import { Auditoria, PerfilCapacidade } from '../database/entities';
import { AuditoriaRegistroService } from './auditoria-registro.service';
import { EnvelopeService } from './envelope.service';
import { PoliticaService } from './politica.service';
import { RedactionService } from './redaction.service';
import { SecurityService } from './security.service';

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([Auditoria, PerfilCapacidade]),
  ],
  providers: [
    EnvelopeService,
    RedactionService,
    PoliticaService,
    AuditoriaRegistroService,
    SecurityService,
  ],
  exports: [
    SecurityService,
    EnvelopeService,
    RedactionService,
    PoliticaService,
    AuditoriaRegistroService,
  ],
})
export class SecurityModule {}
