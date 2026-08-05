import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { RequisicaoAutenticada } from '../auth/requisicao-autenticada';
import { ConfiguracaoService } from '../config/configuracao.service';
import { AmbienteService } from './ambiente.service';
import {
  validarDefinirCapacidadeDto,
  validarNovaFonteDto,
  validarNovoAlvoBancoDto,
  validarNovoServicoDto,
} from './dto/ambiente.dto';

@Controller('ambiente')
export class AmbienteController {
  constructor(
    private readonly ambiente: AmbienteService,
    private readonly configuracao: ConfiguracaoService,
  ) {}

  @Get()
  estado() {
    return this.ambiente.estado();
  }

  @Get('fontes/previa')
  previaDeFonte(@Query('caminho') caminho: string) {
    return this.ambiente.previaDeFonte(caminho);
  }

  @Patch('capacidades')
  definirCapacidade(
    @Body() corpo: unknown,
    @Req() requisicao: RequisicaoAutenticada,
  ) {
    const pedido = validarDefinirCapacidadeDto(corpo);

    return this.configuracao.definirCapacidade(
      pedido.capacidade,
      pedido.ligada,
      this.usuarioId(requisicao),
    );
  }

  @Post('fontes')
  criarFonte(@Body() corpo: unknown, @Req() requisicao: RequisicaoAutenticada) {
    return this.configuracao.criarFonte(
      validarNovaFonteDto(corpo),
      this.usuarioId(requisicao),
    );
  }

  @HttpCode(204)
  @Delete('fontes/:id')
  async removerFonte(
    @Param('id') id: string,
    @Req() requisicao: RequisicaoAutenticada,
  ): Promise<void> {
    await this.configuracao.removerFonte(id, this.usuarioId(requisicao));
  }

  @Post('servicos')
  criarServico(
    @Body() corpo: unknown,
    @Req() requisicao: RequisicaoAutenticada,
  ) {
    return this.configuracao.criarServico(
      validarNovoServicoDto(corpo),
      this.usuarioId(requisicao),
    );
  }

  @HttpCode(204)
  @Delete('servicos/:id')
  async removerServico(
    @Param('id') id: string,
    @Req() requisicao: RequisicaoAutenticada,
  ): Promise<void> {
    await this.configuracao.removerServico(id, this.usuarioId(requisicao));
  }

  @Post('alvos-banco')
  criarAlvoBanco(
    @Body() corpo: unknown,
    @Req() requisicao: RequisicaoAutenticada,
  ) {
    return this.configuracao.criarAlvoBanco(
      validarNovoAlvoBancoDto(corpo),
      this.usuarioId(requisicao),
    );
  }

  @HttpCode(204)
  @Delete('alvos-banco/:id')
  async removerAlvoBanco(
    @Param('id') id: string,
    @Req() requisicao: RequisicaoAutenticada,
  ): Promise<void> {
    await this.configuracao.removerAlvoBanco(id, this.usuarioId(requisicao));
  }

  private usuarioId(requisicao: RequisicaoAutenticada): string | null {
    return requisicao.usuario?.id ?? null;
  }
}
