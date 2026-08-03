import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Aprovacao,
  Conversa,
  FerramentaExecucao,
  Mensagem,
} from '../database/entities';
import { EngineModule } from '../engine/engine.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ConversasController } from './conversas.controller';
import { ConversasService } from './conversas.service';

@Module({
  imports: [
    EngineModule,
    TypeOrmModule.forFeature([
      Conversa,
      Mensagem,
      FerramentaExecucao,
      Aprovacao,
    ]),
  ],
  controllers: [ChatController, ConversasController],
  providers: [ChatService, ConversasService],
})
export class ChatModule {}
