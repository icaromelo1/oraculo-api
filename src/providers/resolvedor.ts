import { Injectable, Logger, Optional } from '@nestjs/common';
import { OraculoConfig } from '../config/config.service';
import {
  ConfiguracaoService,
  type ProvedorAtivo,
} from '../config/configuracao.service';
import { TipoProvedorModelo } from '../database/entities';
import { EventoProvedor, LlmProvider, PedidoGeracao } from './llm-provider';
import {
  ConfigDoProvedor,
  criarLlmProviderDe,
  impressaoDigital,
} from './provider.factory';

interface Instancia {
  digital: string;
  provedor: LlmProvider;
}

export function configDoAtivo(
  ativo: ProvedorAtivo,
  padrao: ConfigDoProvedor,
): ConfigDoProvedor {
  if (ativo.tipo === TipoProvedorModelo.ANTHROPIC) {
    return {
      ...padrao,
      tipo: 'anthropic',
      ...(ativo.chave ? { anthropicChave: ativo.chave } : {}),
      ...(ativo.modelo ? { anthropicModelo: ativo.modelo } : {}),
    };
  }

  if (ativo.tipo === TipoProvedorModelo.OPENAI_COMPAT) {
    return {
      ...padrao,
      tipo: 'openai-compat',
      openaiBaseUrl: ativo.baseUrl ?? undefined,
      openaiChave: ativo.chave ?? undefined,
      openaiModelo: ativo.modelo ?? undefined,
    };
  }

  return {
    ...padrao,
    tipo: 'cli',
    ...(ativo.comando ? { cliComando: ativo.comando } : {}),
    ...(ativo.dialeto
      ? { cliDialeto: ativo.dialeto as ConfigDoProvedor['cliDialeto'] }
      : {}),
    cliModelo: ativo.modelo ?? undefined,
  };
}

@Injectable()
export class ResolvedorDeProvedor implements LlmProvider {
  private readonly logger = new Logger(ResolvedorDeProvedor.name);

  private instancia: Instancia | null = null;

  constructor(
    private readonly config: OraculoConfig,
    @Optional() private readonly configuracao?: ConfiguracaoService,
  ) {}

  get nome(): string {
    const ativo = this.configuracao?.provedorAtivoSincrono() ?? null;

    return ativo ? `${ativo.tipo}:${ativo.nome}` : this.config.provedor.tipo;
  }

  async *gerar(pedido: PedidoGeracao): AsyncIterable<EventoProvedor> {
    let provedor: LlmProvider;

    try {
      provedor = await this.resolver();
    } catch (erro) {
      yield {
        tipo: 'erro',
        codigo: 'provedor_indisponivel',
        mensagem:
          erro instanceof Error
            ? erro.message
            : 'não foi possível montar o provedor de modelo configurado',
        retomavel: false,
      };

      return;
    }

    yield* provedor.gerar(pedido);
  }

  async resolver(): Promise<LlmProvider> {
    return this.instanciar(await this.ativo());
  }

  private async ativo(): Promise<ProvedorAtivo | null> {
    if (!this.configuracao) {
      return null;
    }

    try {
      return await this.configuracao.provedorAtivo();
    } catch (erro) {
      this.logger.warn(
        `não foi possível ler o provedor ativo, valendo o do .env: ${
          erro instanceof Error ? erro.message : String(erro)
        }`,
      );

      return null;
    }
  }

  private instanciar(ativo: ProvedorAtivo | null): LlmProvider {
    const padrao = this.config.provedor;
    const config = ativo ? configDoAtivo(ativo, padrao) : padrao;
    const digital = impressaoDigital(config);

    if (this.instancia?.digital === digital) {
      return this.instancia.provedor;
    }

    const provedor = criarLlmProviderDe(config);

    this.instancia = { digital, provedor };

    return provedor;
  }
}
