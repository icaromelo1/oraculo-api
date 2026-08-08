import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ExigePerfil, PERFIL_DONO } from '../auth/exige-perfil.decorator';
import type { RequisicaoAutenticada } from '../auth/requisicao-autenticada';
import { abrirSessaoPostgres } from '../capabilities/banco/conexao';
import { verificarSomenteLeitura } from '../capabilities/banco/verificacao-alvo';
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

  @ExigePerfil(PERFIL_DONO)
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

  @ExigePerfil(PERFIL_DONO)
  @Post('fontes')
  criarFonte(@Body() corpo: unknown, @Req() requisicao: RequisicaoAutenticada) {
    return this.configuracao.criarFonte(
      validarNovaFonteDto(corpo),
      this.usuarioId(requisicao),
    );
  }

  @HttpCode(204)
  @ExigePerfil(PERFIL_DONO)
  @Delete('fontes/:id')
  async removerFonte(
    @Param('id') id: string,
    @Req() requisicao: RequisicaoAutenticada,
  ): Promise<void> {
    await this.configuracao.removerFonte(id, this.usuarioId(requisicao));
  }

  @ExigePerfil(PERFIL_DONO)
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
  @ExigePerfil(PERFIL_DONO)
  @Delete('servicos/:id')
  async removerServico(
    @Param('id') id: string,
    @Req() requisicao: RequisicaoAutenticada,
  ): Promise<void> {
    await this.configuracao.removerServico(id, this.usuarioId(requisicao));
  }

  @ExigePerfil(PERFIL_DONO)
  @Post('alvos-banco')
  async criarAlvoBanco(
    @Body() corpo: unknown,
    @Req() requisicao: RequisicaoAutenticada,
  ) {
    const alvo = validarNovoAlvoBancoDto(corpo);

    const banco = (await this.configuracao.capacidadesEfetivas()).find(
      (item) => item.capacidade === 'banco',
    );

    if (!banco?.tetoDoEnv) {
      throw new ForbiddenException(
        'a capacidade "banco" está desligada por CAP_BANCO=off no .env desta instalação',
      );
    }

    const veredicto = await verificarSomenteLeitura(
      alvo.url,
      alvo.schemas ?? [],
      abrirSessaoPostgres,
    );

    if (!veredicto.somenteLeitura) {
      throw new BadRequestException(veredicto.motivo);
    }

    return this.configuracao.criarAlvoBanco(alvo, this.usuarioId(requisicao));
  }

  @HttpCode(204)
  @ExigePerfil(PERFIL_DONO)
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
