import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { RequisicaoAutenticada } from '../auth/requisicao-autenticada';
import {
  BibliotecaService,
  DocumentoAberto,
  ListaDocumentos,
} from './biblioteca.service';
import {
  ArquivoEnviado,
  ConhecimentoService,
  LoteEnviado,
  MAXIMO_DE_ARQUIVOS_POR_LOTE,
  NotaGravada,
  TAMANHO_MAXIMO_BYTES,
} from './conhecimento.service';
import { CriarNotaDto } from './dto/criar-nota.dto';
import { EditarNotaDto } from './dto/editar-nota.dto';
import { validarListarDocumentosDto } from './dto/listar-documentos.dto';
import { SlugNotaDto } from './dto/slug-nota.dto';

const CAMPO_DO_ARQUIVO = 'arquivo';

@Controller('conhecimento')
export class ConhecimentoController {
  constructor(
    private readonly conhecimento: ConhecimentoService,
    private readonly biblioteca: BibliotecaService,
  ) {}

  @Get('pastas')
  pastas() {
    return this.biblioteca.pastas();
  }

  @Get('documentos')
  listarDocumentos(@Query() query: unknown): Promise<ListaDocumentos> {
    return this.biblioteca.listar(validarListarDocumentosDto(query));
  }

  @Get('documentos/:id')
  abrirDocumento(@Param('id') id: string): Promise<DocumentoAberto> {
    return this.biblioteca.abrir(id);
  }

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
    FilesInterceptor(CAMPO_DO_ARQUIVO, MAXIMO_DE_ARQUIVOS_POR_LOTE, {
      limits: {
        fileSize: TAMANHO_MAXIMO_BYTES,
        files: MAXIMO_DE_ARQUIVOS_POR_LOTE,
      },
    }),
  )
  enviarArquivos(
    @UploadedFiles() arquivos: ArquivoEnviado[] | undefined,
    @Req() requisicao: RequisicaoAutenticada,
  ): Promise<LoteEnviado> {
    return this.conhecimento.enviarArquivos(
      arquivos,
      this.usuarioId(requisicao),
    );
  }

  @Put('notas/:slug')
  editarNota(
    @Param() parametros: SlugNotaDto,
    @Body() corpo: EditarNotaDto,
    @Req() requisicao: RequisicaoAutenticada,
  ): Promise<NotaGravada> {
    return this.conhecimento.editarNota(
      parametros.slug,
      corpo.conteudo,
      this.usuarioId(requisicao),
    );
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
