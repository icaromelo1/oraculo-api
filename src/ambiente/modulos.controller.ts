import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { RequisicaoAutenticada } from '../auth/requisicao-autenticada';
import {
  ConfiguracaoService,
  type ModuloResumido,
  type MudancaDeModulo,
} from '../config/configuracao.service';
import {
  validarDefinirEspecialistaDto,
  validarEdicaoDeModuloDto,
  validarMoverDocumentosDto,
  validarNovoModuloDto,
} from './dto/modulo.dto';

@Controller('ambiente/modulos')
export class ModulosController {
  constructor(private readonly configuracao: ConfiguracaoService) {}

  @Get()
  async listar(): Promise<{ modulos: ModuloResumido[]; mapa: string }> {
    const [modulos, mapa] = await Promise.all([
      this.configuracao.modulos(),
      this.configuracao.mapaDeModulos(),
    ]);

    return { modulos, mapa };
  }

  @Post()
  criar(
    @Body() corpo: unknown,
    @Req() requisicao: RequisicaoAutenticada,
  ): Promise<ModuloResumido> {
    return this.configuracao.criarModulo(
      validarNovoModuloDto(corpo),
      this.usuarioId(requisicao),
    );
  }

  @Post('mover')
  mover(
    @Body() corpo: unknown,
    @Req() requisicao: RequisicaoAutenticada,
  ): Promise<MudancaDeModulo> {
    const pedido = validarMoverDocumentosDto(corpo);

    return this.configuracao.moverDocumentos(
      pedido.documentos,
      pedido.moduloId,
      this.usuarioId(requisicao),
    );
  }

  @Patch(':id')
  atualizar(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() requisicao: RequisicaoAutenticada,
  ): Promise<ModuloResumido> {
    return this.configuracao.atualizarModulo(
      id,
      validarEdicaoDeModuloDto(corpo),
      this.usuarioId(requisicao),
    );
  }

  @HttpCode(204)
  @Delete(':id')
  async remover(
    @Param('id') id: string,
    @Req() requisicao: RequisicaoAutenticada,
  ): Promise<void> {
    await this.configuracao.removerModulo(id, this.usuarioId(requisicao));
  }

  @Post(':id/especialista')
  definirEspecialista(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() requisicao: RequisicaoAutenticada,
  ): Promise<ModuloResumido> {
    const pedido = validarDefinirEspecialistaDto(corpo);

    return this.configuracao.definirEspecialista(
      id,
      pedido.documentoId,
      this.usuarioId(requisicao),
    );
  }

  private usuarioId(requisicao: RequisicaoAutenticada): string | null {
    return requisicao.usuario?.id ?? null;
  }
}
