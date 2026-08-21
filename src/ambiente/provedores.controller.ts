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
import { ExigePerfil, PERFIL_DONO } from '../auth/exige-perfil.decorator';
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
    travado: boolean;
    motivoDaTrava?: string;
  }> {
    const provedores = await this.configuracao.provedores();
    const travado = this.config.provedorTravado;

    return {
      provedores,
      ativo: provedores.find((provedor) => provedor.ativo) ?? null,
      tiposPermitidos: [...this.config.provedoresPermitidos],
      travado,
      // A tela mostra a configuração mesmo travada: quem clonar o Oráculo precisa
      // ver como está montado para reproduzir do próprio jeito.
      ...(travado
        ? {
            motivoDaTrava:
              'o provedor está fixado no .env desta instalação (PROVEDOR_TRAVADO=true). A configuração fica visível, mas só muda editando o .env no servidor e reiniciando a API.',
          }
        : {}),
    };
  }

  @Get('presets')
  presets() {
    return { presets: PRESETS_DE_PROVEDOR };
  }

  @ExigePerfil(PERFIL_DONO)
  @Post()
  criar(@Body() corpo: unknown, @Req() requisicao: RequisicaoAutenticada) {
    return this.configuracao.criarProvedor(
      validarNovoProvedorDto(corpo),
      this.usuarioId(requisicao),
    );
  }

  @ExigePerfil(PERFIL_DONO)
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

  @ExigePerfil(PERFIL_DONO)
  @Post(':id/ativar')
  ativar(@Param('id') id: string, @Req() requisicao: RequisicaoAutenticada) {
    return this.configuracao.ativarProvedor(id, this.usuarioId(requisicao));
  }

  @ExigePerfil(PERFIL_DONO)
  @Post(':id/testar')
  testarCadastrado(
    @Param('id') id: string,
    @Req() requisicao: RequisicaoAutenticada,
  ): Promise<ResultadoDoTeste> {
    return this.teste.testarCadastrado(id, this.usuarioId(requisicao));
  }

  @HttpCode(204)
  @ExigePerfil(PERFIL_DONO)
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
