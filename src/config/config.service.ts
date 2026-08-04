import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema';

@Injectable()
export class OraculoConfig {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private ler<C extends keyof Env>(chave: C): Env[C] {
    return this.config.get(chave, { infer: true });
  }

  get porta() {
    return this.ler('PORT');
  }

  get ambiente() {
    return this.ler('NODE_ENV');
  }

  get bancoUrl() {
    return this.ler('DATABASE_URL');
  }

  get provedor() {
    return {
      tipo: this.ler('MODEL_PROVIDER'),
      cliComando: this.ler('CLI_COMANDO'),
      cliTimeoutMs: this.ler('CLI_TIMEOUT_MS'),
      cliDialeto: this.ler('CLI_DIALETO'),
      cliModelo: this.ler('CLI_MODELO'),
      anthropicChave: this.ler('ANTHROPIC_API_KEY'),
      anthropicModelo: this.ler('ANTHROPIC_MODELO'),
      openaiBaseUrl: this.ler('OPENAI_BASE_URL'),
      openaiChave: this.ler('OPENAI_API_KEY'),
      openaiModelo: this.ler('OPENAI_MODELO'),
    };
  }

  get recuperacao() {
    return {
      modo: this.ler('RETRIEVAL_MODE'),
      modeloEmbedding: this.ler('EMBEDDING_MODELO'),
      dimensoes: this.ler('EMBEDDING_DIMENSOES'),
    };
  }

  get corpus() {
    return {
      fontes: this.ler('CORPUS_FONTES'),
      negados: this.ler('CORPUS_NEGADOS'),
      exibicao: this.ler('CAMINHO_EXIBICAO'),
    };
  }

  get capacidades() {
    return {
      conhecimento: this.ler('CAP_CONHECIMENTO'),
      codigo: this.ler('CAP_CODIGO'),
      estado: this.ler('CAP_ESTADO'),
      banco: this.ler('CAP_BANCO'),
    };
  }

  get escopos() {
    return {
      repos: this.ler('CODIGO_REPOS'),
      comandos: this.ler('ESTADO_COMANDOS'),
      bancos: this.ler('BANCO_ALVOS'),
    };
  }

  get auth() {
    return {
      modo: this.ler('AUTH_MODE'),
      segredo: this.ler('JWT_SECRET'),
      ttl: this.ler('JWT_TTL'),
    };
  }

  get segredoDeConfiguracao() {
    return this.ler('CONFIG_SECRET') ?? this.ler('JWT_SECRET');
  }

  get engine() {
    return {
      maxIteracoes: this.ler('ENGINE_MAX_ITERACOES'),
      maxTokensSaida: this.ler('ENGINE_MAX_TOKENS_SAIDA'),
      guardiao: this.ler('GUARD_MODE') === 'on',
    };
  }

  get github() {
    return {
      token: this.ler('GITHUB_TOKEN'),
      usuario: this.ler('GITHUB_USUARIO'),
    };
  }
}
