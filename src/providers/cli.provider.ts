import { spawn } from 'node:child_process';
import { AnalisadorEventosAgy } from './agy.analisador';
import {
  AnalisadorGenerico,
  DialetoResolvido,
  montarArgv,
  resolverDialeto,
} from './dialeto';
import { EventoProvedor, LlmProvider, PedidoGeracao } from './llm-provider';
import type { ConfigDoProvedor } from './provider.factory';
import {
  analisarJsonSeguro,
  ehObjeto,
  lerNumero,
  lerString,
} from './parsing-utils';

const SINAL_ENCERRAMENTO_FORCADO_MS = 5_000;
const TENTATIVAS_POR_GERACAO = 3;

export class AnalisadorEventosCli {
  private bufferizador = '';
  private tiposPorIndice = new Map<number, string>();

  processarChunk(chunk: string): EventoProvedor[] {
    this.bufferizador += chunk;
    const linhas = this.bufferizador.split('\n');
    this.bufferizador = linhas.pop() ?? '';

    const eventos: EventoProvedor[] = [];
    for (const linha of linhas) {
      eventos.push(...this.processarLinha(linha));
    }
    return eventos;
  }

  private processarLinha(linha: string): EventoProvedor[] {
    const texto = linha.trim();
    if (!texto) {
      return [];
    }

    const bruto = analisarJsonSeguro(texto);
    if (!ehObjeto(bruto)) {
      return [];
    }

    return this.interpretarJson(bruto);
  }

  private interpretarJson(bruto: Record<string, unknown>): EventoProvedor[] {
    const tipo = lerString(bruto.type);

    if (
      tipo === 'system' ||
      tipo === 'rate_limit_event' ||
      tipo === 'assistant'
    ) {
      return [];
    }

    if (tipo === 'stream_event') {
      return this.interpretarStreamEvent(bruto.event);
    }

    if (tipo === 'result') {
      return [this.construirEventoFim(bruto)];
    }

    return [];
  }

  private interpretarStreamEvent(bruto: unknown): EventoProvedor[] {
    if (!ehObjeto(bruto)) {
      return [];
    }

    const tipoEvento = lerString(bruto.type);
    const indice = lerNumero(bruto.index);

    if (tipoEvento === 'content_block_start' && indice !== undefined) {
      const blocoConteudo = bruto.content_block;
      const tipoBloco = ehObjeto(blocoConteudo)
        ? lerString(blocoConteudo.type)
        : undefined;
      if (tipoBloco) {
        this.tiposPorIndice.set(indice, tipoBloco);
      }
      return [];
    }

    if (tipoEvento === 'content_block_delta' && indice !== undefined) {
      return this.interpretarDelta(indice, bruto.delta);
    }

    return [];
  }

  private interpretarDelta(indice: number, bruto: unknown): EventoProvedor[] {
    if (!ehObjeto(bruto)) {
      return [];
    }

    const tipoDelta = lerString(bruto.type);
    const tipoBloco = this.tiposPorIndice.get(indice);

    if (tipoDelta === 'text_delta' && tipoBloco === 'text') {
      const texto = lerString(bruto.text);
      return texto !== undefined ? [{ tipo: 'texto', fragmento: texto }] : [];
    }

    if (tipoDelta === 'thinking_delta') {
      const raciocinio = lerString(bruto.thinking);
      return raciocinio !== undefined
        ? [{ tipo: 'raciocinio', fragmento: raciocinio }]
        : [];
    }

    return [];
  }

  private construirEventoFim(bruto: Record<string, unknown>): EventoProvedor {
    const usage: Record<string, unknown> = ehObjeto(bruto.usage)
      ? bruto.usage
      : {};

    const entrada =
      (lerNumero(usage.input_tokens) ?? 0) +
      (lerNumero(usage.cache_creation_input_tokens) ?? 0) +
      (lerNumero(usage.cache_read_input_tokens) ?? 0);

    return {
      tipo: 'fim',
      tokensEntrada: entrada,
      tokensSaida: lerNumero(usage.output_tokens) ?? 0,
      duracaoMs: lerNumero(bruto.duration_api_ms) ?? 0,
      custoUsd: lerNumero(bruto.total_cost_usd),
    };
  }
}

class FilaAssincrona<T> {
  private itens: T[] = [];
  private encerrada = false;
  private resolversEspera: (() => void)[] = [];

  empurrar(item: T): void {
    this.itens.push(item);
    this.liberarEspera();
  }

  encerrar(): void {
    this.encerrada = true;
    this.liberarEspera();
  }

  private liberarEspera(): void {
    const resolvers = this.resolversEspera;
    this.resolversEspera = [];
    for (const resolver of resolvers) {
      resolver();
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<T> {
    for (;;) {
      const item = this.itens.shift();
      if (item !== undefined) {
        yield item;
        continue;
      }

      if (this.encerrada) {
        return;
      }

      await new Promise<void>((resolve) => {
        this.resolversEspera.push(resolve);
      });
    }
  }
}

function extrairBinario(cliComando: string): string {
  const partes = cliComando.trim().split(/\s+/).filter(Boolean);
  return partes[0] ?? 'claude';
}

function construirPrompt(pedido: PedidoGeracao): string {
  return pedido.mensagens
    .map((mensagem) => `${mensagem.papel}: ${mensagem.texto}`)
    .join('\n\n');
}

function construirPromptComSistema(pedido: PedidoGeracao): string {
  return `${pedido.sistema}\n\n${construirPrompt(pedido)}`;
}

interface AnalisadorDeSaida {
  processarChunk(chunk: string): EventoProvedor[];
  finalizar?(): EventoProvedor[];
}

function criarAnalisador(dialeto: DialetoResolvido): AnalisadorDeSaida {
  if (dialeto.origem === 'preset') {
    return dialeto.preset === 'agy'
      ? new AnalisadorEventosAgy()
      : new AnalisadorEventosCli();
  }

  return new AnalisadorGenerico(dialeto.descritor);
}

export class CliProvider implements LlmProvider {
  readonly nome = 'cli';

  constructor(private readonly config: ConfigDoProvedor) {}

  async *gerar(pedido: PedidoGeracao): AsyncIterable<EventoProvedor> {
    for (let tentativa = 1; tentativa <= TENTATIVAS_POR_GERACAO; tentativa++) {
      const ultima = tentativa === TENTATIVAS_POR_GERACAO;
      const retidos: EventoProvedor[] = [];
      let fluindo = false;
      let houveErro = false;

      for await (const evento of this.gerarUmaVez(pedido)) {
        if (fluindo) {
          yield evento;

          continue;
        }

        if (evento.tipo === 'erro') {
          houveErro = true;
        }

        const temConteudo =
          evento.tipo === 'texto' && evento.fragmento.trim() !== '';

        if (temConteudo || houveErro || ultima) {
          fluindo = true;

          for (const retido of retidos) {
            yield retido;
          }

          yield evento;

          continue;
        }

        retidos.push(evento);
      }

      if (fluindo) {
        return;
      }
    }
  }

  private async *gerarUmaVez(
    pedido: PedidoGeracao,
  ): AsyncIterable<EventoProvedor> {
    const { cliComando, cliTimeoutMs, cliDialeto, cliModelo, anthropicModelo } =
      this.config;
    const binario = extrairBinario(cliComando);

    let dialeto: DialetoResolvido;

    try {
      dialeto = resolverDialeto(cliDialeto, binario);
    } catch (erro) {
      yield {
        tipo: 'erro',
        codigo: 'dialeto_invalido',
        mensagem:
          erro instanceof Error
            ? erro.message
            : 'o dialeto configurado para o provedor CLI não pôde ser lido',
        retomavel: false,
      };

      return;
    }

    const argv = montarArgv(dialeto.descritor, {
      prompt: construirPrompt(pedido),
      promptComSistema: construirPromptComSistema(pedido),
      sistema: pedido.sistema,
      modelo: cliModelo ?? '',
      modeloOuPadrao: cliModelo ?? anthropicModelo,
      timeoutMs: cliTimeoutMs,
    });

    const fila = new FilaAssincrona<EventoProvedor>();
    const analisador = criarAnalisador(dialeto);
    let stderrTexto = '';
    let expirou = false;

    const processo = spawn(binario, argv, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const cronometro = setTimeout(() => {
      expirou = true;
      processo.kill('SIGTERM');
      setTimeout(() => {
        processo.kill('SIGKILL');
      }, SINAL_ENCERRAMENTO_FORCADO_MS);
    }, cliTimeoutMs);

    processo.stdout.setEncoding('utf8');
    processo.stdout.on('data', (pedaco: string) => {
      for (const evento of analisador.processarChunk(pedaco)) {
        fila.empurrar(evento);
      }
    });

    processo.stderr.setEncoding('utf8');
    processo.stderr.on('data', (pedaco: string) => {
      stderrTexto += pedaco;
    });

    processo.on('error', (erro) => {
      clearTimeout(cronometro);
      fila.empurrar({
        tipo: 'erro',
        codigo: 'cli_spawn_falhou',
        mensagem: erro.message,
        retomavel: false,
      });
      fila.encerrar();
    });

    processo.on('close', (codigo) => {
      clearTimeout(cronometro);
      if (expirou) {
        fila.empurrar({
          tipo: 'erro',
          codigo: 'cli_timeout',
          mensagem: `Provedor CLI excedeu o timeout de ${cliTimeoutMs}ms`,
          retomavel: true,
        });
      } else if (codigo !== 0) {
        fila.empurrar({
          tipo: 'erro',
          codigo: 'cli_saida_nao_zero',
          mensagem:
            stderrTexto.trim() || `Processo CLI terminou com código ${codigo}`,
          retomavel: true,
        });
      } else if (analisador.finalizar) {
        for (const evento of analisador.finalizar()) {
          fila.empurrar(evento);
        }
      }
      fila.encerrar();
    });

    yield* fila;
  }
}
