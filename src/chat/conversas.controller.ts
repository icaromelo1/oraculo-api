import { Controller, Get, Param, Req } from '@nestjs/common';
import type { RequisicaoAutenticada } from '../auth/requisicao-autenticada';
import { ConversasService } from './conversas.service';

@Controller('conversas')
export class ConversasController {
  constructor(private readonly conversas: ConversasService) {}

  @Get()
  listar(@Req() requisicao: RequisicaoAutenticada) {
    return this.conversas.listar(requisicao.usuario.id);
  }

  @Get(':id')
  obter(@Param('id') id: string, @Req() requisicao: RequisicaoAutenticada) {
    return this.conversas.obter(id, requisicao.usuario.id);
  }
}
