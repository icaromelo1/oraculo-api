import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { RequisicaoAutenticada } from '../auth/requisicao-autenticada';
import {
  ArquivoEnviado,
  ConhecimentoService,
  NotaGravada,
  TAMANHO_MAXIMO_BYTES,
} from './conhecimento.service';
import { CriarNotaDto } from './dto/criar-nota.dto';
import { SlugNotaDto } from './dto/slug-nota.dto';

export const CAMPO_DO_ARQUIVO = 'arquivo';

@Controller('conhecimento')
export class ConhecimentoController {
  constructor(private readonly conhecimento: ConhecimentoService) {}

  @Get('notas')
  listarNotas() {
    return this.conhecimento.listarNotas();
  }

  @Post('notas')
  criarNota(
    @Body() corpo: CriarNotaDto,
    @Req() requisicao: RequisicaoAutenticada,
  ): Promise<NotaGravada> {
    return this.conhecimento.criarNota(corpo, this.usuarioId(requisicao));
  }

  @Post('arquivos')
  @UseInterceptors(
    FileInterceptor(CAMPO_DO_ARQUIVO, {
      limits: { fileSize: TAMANHO_MAXIMO_BYTES, files: 1 },
    }),
  )
  enviarArquivo(
    @UploadedFile() arquivo: ArquivoEnviado | undefined,
    @Req() requisicao: RequisicaoAutenticada,
  ): Promise<NotaGravada> {
    return this.conhecimento.enviarArquivo(arquivo, this.usuarioId(requisicao));
  }

  @HttpCode(204)
  @Delete('notas/:slug')
  async removerNota(
    @Param() parametros: SlugNotaDto,
    @Req() requisicao: RequisicaoAutenticada,
  ): Promise<void> {
    await this.conhecimento.removerNota(
      parametros.slug,
      this.usuarioId(requisicao),
    );
  }

  private usuarioId(requisicao: RequisicaoAutenticada): string | null {
    return requisicao.usuario?.id ?? null;
  }
}
