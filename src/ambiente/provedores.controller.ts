import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { RequisicaoAutenticada } from '../auth/requisicao-autenticada';
import { OraculoConfig } from '../config/config.service';
import {
  ConfiguracaoService,
  type ProvedorResumido,
} from '../config/configuracao.service';
import { PRESETS_DE_PROVEDOR } from '../providers/presets';
import {
  validarNovoProvedorDto,
  validarTesteDeProvedorDto,
} from './dto/provedor.dto';
import {
  TesteDeProvedorService,
  type ResultadoDoTeste,
} from './teste-provedor.service';

@Controller('ambiente/provedores')
export class ProvedoresController {
  constructor(
    private readonly configuracao: ConfiguracaoService,
    private readonly teste: TesteDeProvedorService,
    private readonly config: OraculoConfig,
  ) {}

  @Get()
  async listar(): Promise<{
    provedores: ProvedorResumido[];
    ativo: ProvedorResumido | null;
    tiposPermitidos: string[];
  }> {
    const provedores = await this.configuracao.provedores();

    return {
      provedores,
      ativo: provedores.find((provedor) => provedor.ativo) ?? null,
      tiposPermitidos: [...this.config.provedoresPermitidos],
    };
  }

  @Get('presets')
  presets() {
    return { presets: PRESETS_DE_PROVEDOR };
  }

  @Post()
  criar(@Body() corpo: unknown, @Req() requisicao: RequisicaoAutenticada) {
    return this.configuracao.criarProvedor(
      validarNovoProvedorDto(corpo),
      this.usuarioId(requisicao),
    );
  }

  @Post('testar')
  testarAvulso(
    @Body() corpo: unknown,
    @Req() requisicao: RequisicaoAutenticada,
  ): Promise<ResultadoDoTeste> {
    return this.teste.testarAvulso(
      validarTesteDeProvedorDto(corpo),
      this.usuarioId(requisicao),
    );
  }

  @Post(':id/ativar')
  ativar(@Param('id') id: string, @Req() requisicao: RequisicaoAutenticada) {
    return this.configuracao.ativarProvedor(id, this.usuarioId(requisicao));
  }

  @Post(':id/testar')
  testarCadastrado(
    @Param('id') id: string,
    @Req() requisicao: RequisicaoAutenticada,
  ): Promise<ResultadoDoTeste> {
    return this.teste.testarCadastrado(id, this.usuarioId(requisicao));
  }

  @HttpCode(204)
  @Delete(':id')
  async remover(
    @Param('id') id: string,
    @Req() requisicao: RequisicaoAutenticada,
  ): Promise<void> {
    await this.configuracao.removerProvedor(id, this.usuarioId(requisicao));
  }

  private usuarioId(requisicao: RequisicaoAutenticada): string | null {
    return requisicao.usuario?.id ?? null;
  }
}
