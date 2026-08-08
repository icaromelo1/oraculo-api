import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ExigePerfil, PERFIL_DONO } from '../auth/exige-perfil.decorator';
import type { RequisicaoAutenticada } from '../auth/requisicao-autenticada';
import {
  validarAprovacaoDto,
  validarDescarteDto,
  validarNovaPropostaDto,
  validarStatusDeProposta,
} from './dto/proposta.dto';
import {
  Decisor,
  PropostaAprovada,
  PropostaResumida,
  PropostasService,
} from './propostas.service';

@Controller('propostas')
export class PropostasController {
  constructor(private readonly propostas: PropostasService) {}

  @Get()
  listar(@Query('status') status?: string): Promise<PropostaResumida[]> {
    return this.propostas.listar(validarStatusDeProposta(status));
  }

  @Post()
  criar(
    @Body() corpo: unknown,
    @Req() requisicao: RequisicaoAutenticada,
  ): Promise<PropostaResumida> {
    return this.propostas.criar(
      validarNovaPropostaDto(corpo),
      this.decisor(requisicao).id,
    );
  }

  @ExigePerfil(PERFIL_DONO)
  @Post(':id/aprovar')
  aprovar(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() requisicao: RequisicaoAutenticada,
  ): Promise<PropostaAprovada> {
    return this.propostas.aprovar(
      id,
      validarAprovacaoDto(corpo),
      this.decisor(requisicao),
    );
  }

  @ExigePerfil(PERFIL_DONO)
  @Post(':id/descartar')
  descartar(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() requisicao: RequisicaoAutenticada,
  ): Promise<PropostaResumida> {
    return this.propostas.descartar(
      id,
      validarDescarteDto(corpo),
      this.decisor(requisicao),
    );
  }

  private decisor(requisicao: RequisicaoAutenticada): Decisor {
    return {
      id: requisicao.usuario?.id ?? null,
      login: requisicao.usuario?.login ?? null,
    };
  }
}
