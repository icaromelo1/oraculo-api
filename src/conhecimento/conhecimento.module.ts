import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfiguracaoModule } from '../config/configuracao.module';
import { CorpusModule } from '../corpus/corpus.module';
import { Documento, Trecho } from '../database/entities';
import { SecurityModule } from '../security/security.module';
import { BibliotecaService } from './biblioteca.service';
import { ConhecimentoController } from './conhecimento.controller';
import { ConhecimentoService } from './conhecimento.service';

@Module({
  imports: [
    ConfiguracaoModule,
    CorpusModule,
    SecurityModule,
    TypeOrmModule.forFeature([Documento, Trecho]),
  ],
  controllers: [ConhecimentoController],
  providers: [BibliotecaService, ConhecimentoService],
  exports: [ConhecimentoService],
})
export class ConhecimentoModule {}
