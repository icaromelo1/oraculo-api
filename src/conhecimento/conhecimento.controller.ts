import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import type { RequisicaoAutenticada } from '../auth/requisicao-autenticada';
import {
  ConfiguracaoService,
  type DescricaoDeDocumento,
} from '../config/configuracao.service';
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
import {
  LeitorDeImagemService,
  type TextoDoPrint,
} from './leitor-de-imagem.service';
import { TETO_DA_IMAGEM_BYTES } from './leitura-de-imagem';
import { CriarNotaDto } from './dto/criar-nota.dto';
import { EditarNotaDto } from './dto/editar-nota.dto';
import { validarListarDocumentosDto } from './dto/listar-documentos.dto';
import { SlugNotaDto } from './dto/slug-nota.dto';
import { validarSugerirDescricaoDto } from './dto/sugerir-descricao.dto';
import {
  SugestaoDeDescricao,
  SugestaoDescricaoService,
} from './sugestao-descricao.service';

const CAMPO_DO_ARQUIVO = 'arquivo';

@Controller('conhecimento')
export class ConhecimentoController {
  constructor(
    private readonly conhecimento: ConhecimentoService,
    private readonly biblioteca: BibliotecaService,
    private readonly configuracao: ConfiguracaoService,
    private readonly sugestao: SugestaoDescricaoService,
    private readonly leitorDeImagem: LeitorDeImagemService,
  ) {}

  @HttpCode(200)
  @Post('sugerir-descricao')
  sugerirDescricao(@Body() corpo: unknown): Promise<SugestaoDeDescricao> {
    return this.sugestao.sugerir(validarSugerirDescricaoDto(corpo));
  }

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

  @Patch('documentos/:id')
  descreverDocumento(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() requisicao: RequisicaoAutenticada,
  ): Promise<DescricaoDeDocumento> {
    if (typeof corpo !== 'object' || corpo === null || Array.isArray(corpo)) {
      throw new BadRequestException('corpo da requisição inválido');
    }

    const { descricao } = corpo as Record<string, unknown>;

    if (descricao !== undefined && typeof descricao !== 'string') {
      throw new BadRequestException('"descricao" precisa ser texto');
    }

    return this.configuracao.descreverDocumento(
      id,
      typeof descricao === 'string' ? descricao : '',
      this.usuarioId(requisicao),
    );
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

  /**
   * Lê um print de tela anexado pelo atendimento e devolve o texto que estava nele.
   * A imagem não é gravada em lugar nenhum — só o texto sai daqui, já mascarado.
   */
  @Post('imagem')
  @UseInterceptors(
    FileInterceptor('imagem', {
      limits: { fileSize: TETO_DA_IMAGEM_BYTES, files: 1 },
    }),
  )
  lerImagem(
    @UploadedFile() imagem?: { buffer: Buffer; mimetype: string },
  ): Promise<TextoDoPrint> {
    if (!imagem) {
      throw new BadRequestException('nenhuma imagem enviada');
    }

    return this.leitorDeImagem.ler(imagem.buffer, imagem.mimetype);
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
