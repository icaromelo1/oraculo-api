import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Put,
  Req,
} from '@nestjs/common';
import { ExigePerfil, PERFIL_DONO } from '../auth/exige-perfil.decorator';
import type { RequisicaoAutenticada } from '../auth/requisicao-autenticada';
import { ConfiguracaoService } from '../config/configuracao.service';
import {
  PERSONA_PADRAO,
  TETO_DA_PERSONA,
  truncarPersona,
} from '../engine/instrucao';
import { RedactionService } from '../security/redaction.service';

interface RespostaPersona {
  texto: string;
  padrao: string;
  personalizada: boolean;
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

  @ExigePerfil(PERFIL_DONO)
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
    const efetiva = truncarPersona(texto);

    return {
      texto: efetiva,
      padrao: PERSONA_PADRAO,
      personalizada: efetiva !== PERSONA_PADRAO,
      teto: TETO_DA_PERSONA,
      mascaramentos: this.redacao.redigir(efetiva).total,
    };
  }

  private lerTexto(corpo: unknown): string {
    if (typeof corpo !== 'object' || corpo === null || Array.isArray(corpo)) {
      throw new BadRequestException('corpo da requisição inválido');
    }

    const { texto } = corpo as Record<string, unknown>;

    if (typeof texto !== 'string') {
      throw new BadRequestException('"texto" precisa ser texto');
    }

    if (texto.trim().length === 0) {
      throw new BadRequestException(
        'a persona não pode ficar vazia — é ela que diz quem este assistente é. para voltar ao começo, grave o texto padrão.',
      );
    }

    return texto;
  }
}
