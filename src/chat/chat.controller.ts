import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { RequisicaoAutenticada } from '../auth/requisicao-autenticada';
import { ChatService } from './chat.service';
import { validarPedidoChatDto } from './dto/pedido-chat.dto';

@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @HttpCode(200)
  @Post()
  async responder(
    @Body() corpo: unknown,
    @Req() requisicao: RequisicaoAutenticada,
    @Res() resposta: Response,
  ): Promise<void> {
    const pedido = validarPedidoChatDto(corpo);

    await this.chat.transmitir(
      pedido,
      requisicao.usuario,
      requisicao,
      resposta,
    );
  }
}
