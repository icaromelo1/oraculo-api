import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  ConfiguracaoService,
  type ProvedorAtivo,
} from '../config/configuracao.service';
import { TipoProvedorModelo } from '../database/entities';
import { montarUrlDeChat } from '../providers/openai-compat.provider';
import { RedactionService } from '../security/redaction.service';
import {
  envelopar,
  INSTRUCAO_DE_EXTRACAO,
  montarDataUri,
  recusaDaImagem,
} from './leitura-de-imagem';

const TETO_DE_SAIDA = 1_200;
const TEMPO_LIMITE_MS = 60_000;

export interface TextoDoPrint {
  texto: string;
  mascaramentos: number;
  motivo?: string;
}

/**
 * Lê um print anexado pelo atendimento e devolve o texto que estava nele.
 *
 * A imagem passa por aqui e some: não vai para disco, não vai para o banco,
 * não fica em memória além do turno. O que persiste é o texto, e mascarado.
 */
@Injectable()
export class LeitorDeImagemService {
  private readonly logger = new Logger(LeitorDeImagemService.name);

  constructor(
    private readonly configuracao: ConfiguracaoService,
    private readonly redacao: RedactionService,
  ) {}

  async ler(dados: Buffer, tipo: string | undefined): Promise<TextoDoPrint> {
    const recusa = recusaDaImagem(tipo, dados.length);

    if (recusa) {
      throw new BadRequestException(recusa);
    }

    const provedor = await this.configuracao.provedorAtivo();

    if (!provedor || provedor.tipo !== TipoProvedorModelo.OPENAI_COMPAT) {
      return {
        texto: '',
        mascaramentos: 0,
        motivo:
          'o provedor configurado não lê imagem — configure um provedor compatível com OpenAI e um modelo com visão em Ambiente → Modelo',
      };
    }

    const bruto = await this.pedirExtracao(
      provedor,
      montarDataUri(tipo as string, dados),
    );

    if (bruto === null) {
      return {
        texto: '',
        mascaramentos: 0,
        motivo:
          'não consegui ler a imagem agora — pode ser limite do modelo. Descreva o que aparece no print.',
      };
    }

    const redigido = this.redacao.redigir(bruto.slice(0, TETO_DE_SAIDA));

    return {
      texto: envelopar(redigido.texto),
      mascaramentos: redigido.total,
    };
  }

  private async pedirExtracao(
    provedor: ProvedorAtivo,
    dataUri: string,
  ): Promise<string | null> {
    const base = provedor.baseUrl?.trim();
    const modelo = provedor.modelo?.trim();

    if (!base || !modelo) {
      return null;
    }

    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);

    try {
      const resposta = await fetch(montarUrlDeChat(base), {
        method: 'POST',
        signal: controle.signal,
        headers: {
          'content-type': 'application/json',
          ...(provedor.chave
            ? { authorization: `Bearer ${provedor.chave}` }
            : {}),
        },
        body: JSON.stringify({
          model: modelo,
          max_tokens: 900,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: INSTRUCAO_DE_EXTRACAO },
                { type: 'image_url', image_url: { url: dataUri } },
              ],
            },
          ],
        }),
      });

      if (!resposta.ok) {
        this.logger.warn(
          `leitura de imagem recusada pelo provedor: ${resposta.status}`,
        );

        return null;
      }

      const corpo = (await resposta.json()) as {
        choices?: { message?: { content?: unknown } }[];
      };
      const conteudo = corpo.choices?.[0]?.message?.content;

      return typeof conteudo === 'string' ? conteudo : null;
    } catch (falha) {
      this.logger.warn(
        `falha ao ler a imagem: ${falha instanceof Error ? falha.message : String(falha)}`,
      );

      return null;
    } finally {
      clearTimeout(relogio);
    }
  }
}
