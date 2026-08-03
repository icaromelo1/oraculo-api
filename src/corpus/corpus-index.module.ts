import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CorpusModule } from './corpus.module';

@Module({
  imports: [DatabaseModule, CorpusModule],
})
export class CorpusIndexModule {}
