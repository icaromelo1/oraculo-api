import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Put,
  Req,
} from '@nestjs/common';
import type { RequisicaoAutenticada } from '../auth/requisicao-autenticada';
import { ConfiguracaoService } from '../config/configuracao.service';
import { TETO_DA_PERSONA } from '../engine/instrucao';
import { RedactionService } from '../security/redaction.service';

interface RespostaPersona {
  texto: string | null;
  teto: number;
  mascaramentos: number;
}

@Controller('ambiente/persona')
export class PersonaController {
  constructor(
    private readonly configuracao: ConfiguracaoService,
    private readonly redacao: RedactionService,
  ) {}

  @Get()
  async ler(): Promise<RespostaPersona> {
    return this.responder(await this.configuracao.persona());
  }

  @Put()
  async definir(
    @Body() corpo: unknown,
    @Req() requisicao: RequisicaoAutenticada,
  ): Promise<RespostaPersona> {
    const texto = this.lerTexto(corpo);

    const salva = await this.configuracao.definirPersona(
      texto,
      requisicao.usuario?.id ?? null,
    );

    return this.responder(salva);
  }

  private responder(texto: string | null): RespostaPersona {
    return {
      texto,
      teto: TETO_DA_PERSONA,
      mascaramentos: texto ? this.redacao.redigir(texto).total : 0,
    };
  }

  private lerTexto(corpo: unknown): string {
    if (typeof corpo !== 'object' || corpo === null || Array.isArray(corpo)) {
      throw new BadRequestException('corpo da requisição inválido');
    }

    const { texto } = corpo as Record<string, unknown>;

    if (texto !== undefined && typeof texto !== 'string') {
      throw new BadRequestException('"texto" precisa ser texto');
    }

    return typeof texto === 'string' ? texto : '';
  }
}
