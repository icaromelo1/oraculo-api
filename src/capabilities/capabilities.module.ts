import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Documento, Trecho } from '../database/entities';
import { EmbeddingService } from '../corpus/embedding.service';
import { CAPACIDADE, Capacidade } from './capacidade';
import { BuscarConhecimentoCapacidade } from './conhecimento/buscar-conhecimento.capacidade';
import { LerDocumentoCapacidade } from './conhecimento/ler-documento.capacidade';
import { BuscarCodigoCapacidade, LerArquivoCapacidade } from './codigo';
import { RegistryCapacidades } from './registry.service';

@Module({
  imports: [TypeOrmModule.forFeature([Documento, Trecho])],
  providers: [
    RegistryCapacidades,
    EmbeddingService,
    BuscarConhecimentoCapacidade,
    LerDocumentoCapacidade,
    BuscarCodigoCapacidade,
    LerArquivoCapacidade,
    {
      provide: CAPACIDADE,
      inject: [
        BuscarConhecimentoCapacidade,
        LerDocumentoCapacidade,
        BuscarCodigoCapacidade,
        LerArquivoCapacidade,
      ],
      useFactory: (
        buscarConhecimento: BuscarConhecimentoCapacidade,
        lerDocumento: LerDocumentoCapacidade,
        buscarCodigo: BuscarCodigoCapacidade,
        lerArquivo: LerArquivoCapacidade,
      ): Capacidade[] => [
        buscarConhecimento,
        lerDocumento,
        buscarCodigo,
        lerArquivo,
      ],
    },
  ],
  exports: [RegistryCapacidades],
})
export class CapabilitiesModule {}
