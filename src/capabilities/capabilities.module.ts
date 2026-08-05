import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DiagnosticoController } from '../ambiente/diagnostico.controller';
import { ConfiguracaoModule } from '../config/configuracao.module';
import { Documento, Trecho } from '../database/entities';
import { EmbeddingService } from '../corpus/embedding.service';
import { SecurityModule } from '../security/security.module';
import { CAPACIDADE, Capacidade } from './capacidade';
import { BuscarConhecimentoCapacidade } from './conhecimento/buscar-conhecimento.capacidade';
import { LerDocumentoCapacidade } from './conhecimento/ler-documento.capacidade';
import { ConsultarBancoCapacidade, ExecutorConsulta } from './banco';
import { BuscarCodigoCapacidade, LerArquivoCapacidade } from './codigo';
import { DiagnosticoCapacidade, ExecutorDiagnostico } from './diagnostico';
import { RegistryCapacidades } from './registry.service';

@Module({
  imports: [
    ConfiguracaoModule,
    SecurityModule,
    TypeOrmModule.forFeature([Documento, Trecho]),
  ],
  controllers: [DiagnosticoController],
  providers: [
    RegistryCapacidades,
    EmbeddingService,
    ExecutorDiagnostico,
    ExecutorConsulta,
    BuscarConhecimentoCapacidade,
    LerDocumentoCapacidade,
    BuscarCodigoCapacidade,
    LerArquivoCapacidade,
    DiagnosticoCapacidade,
    ConsultarBancoCapacidade,
    {
      provide: CAPACIDADE,
      inject: [
        BuscarConhecimentoCapacidade,
        LerDocumentoCapacidade,
        BuscarCodigoCapacidade,
        LerArquivoCapacidade,
        DiagnosticoCapacidade,
        ConsultarBancoCapacidade,
      ],
      useFactory: (
        buscarConhecimento: BuscarConhecimentoCapacidade,
        lerDocumento: LerDocumentoCapacidade,
        buscarCodigo: BuscarCodigoCapacidade,
        lerArquivo: LerArquivoCapacidade,
        diagnostico: DiagnosticoCapacidade,
        consultarBanco: ConsultarBancoCapacidade,
      ): Capacidade[] => [
        buscarConhecimento,
        lerDocumento,
        buscarCodigo,
        lerArquivo,
        diagnostico,
        consultarBanco,
      ],
    },
  ],
  exports: [RegistryCapacidades],
})
export class CapabilitiesModule {}
