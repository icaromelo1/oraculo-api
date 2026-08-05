import { Module } from '@nestjs/common';
import { CorpusModule } from '../corpus/corpus.module';
import { SecurityModule } from '../security/security.module';
import { ConhecimentoController } from './conhecimento.controller';
import { ConhecimentoService } from './conhecimento.service';

@Module({
  imports: [CorpusModule, SecurityModule],
  controllers: [ConhecimentoController],
  providers: [ConhecimentoService],
  exports: [ConhecimentoService],
})
export class ConhecimentoModule {}
