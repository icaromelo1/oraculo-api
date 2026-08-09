import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfiguracaoModule } from '../config/configuracao.module';
import { CorpusModule } from '../corpus/corpus.module';
import { Documento, Trecho } from '../database/entities';
import { ProvidersModule } from '../providers/providers.module';
import { SecurityModule } from '../security/security.module';
import { BibliotecaService } from './biblioteca.service';
import { ConhecimentoController } from './conhecimento.controller';
import { ConhecimentoService } from './conhecimento.service';
import { LeitorDeImagemService } from './leitor-de-imagem.service';
import { SugestaoDescricaoService } from './sugestao-descricao.service';

@Module({
  imports: [
    ConfiguracaoModule,
    CorpusModule,
    ProvidersModule,
    SecurityModule,
    TypeOrmModule.forFeature([Documento, Trecho]),
  ],
  controllers: [ConhecimentoController],
  providers: [
    BibliotecaService,
    ConhecimentoService,
    LeitorDeImagemService,
    SugestaoDescricaoService,
  ],
  exports: [ConhecimentoService, SugestaoDescricaoService],
})
export class ConhecimentoModule {}
