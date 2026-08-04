import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfiguracaoModule } from '../config/configuracao.module';
import { Documento, Trecho } from '../database/entities';
import { EmbeddingService } from './embedding.service';
import { IndexacaoService } from './indexacao.service';
import { VarreduraService } from './varredura.service';

@Module({
  imports: [ConfiguracaoModule, TypeOrmModule.forFeature([Documento, Trecho])],
  providers: [VarreduraService, EmbeddingService, IndexacaoService],
  exports: [IndexacaoService],
})
export class CorpusModule {}
