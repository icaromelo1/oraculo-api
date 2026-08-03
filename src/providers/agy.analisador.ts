import { EventoProvedor, PedidoGeracao } from './llm-provider';
import {
  analisarJsonSeguro,
  ehObjeto,
  lerNumero,
  lerString,
} from './parsing-utils';

export class AnalisadorEventosAgy {
  private bufferizador = '';

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

    const evento = lerString(bruto.event);

    if (evento === 'step_update') {
      return this.interpretarPasso(bruto.step_update);
    }

    if (evento === 'result') {
      return this.interpretarResultado(bruto.result);
    }

    return [];
  }

  private interpretarPasso(bruto: unknown): EventoProvedor[] {
    if (!ehObjeto(bruto)) {
      return [];
    }

    if (lerString(bruto.step_type) !== 'agent_response') {
      return [];
    }

    const fragmento = lerString(bruto.text_delta);
    return fragmento ? [{ tipo: 'texto', fragmento }] : [];
  }

  private interpretarResultado(bruto: unknown): EventoProvedor[] {
    if (!ehObjeto(bruto)) {
      return [];
    }

    const status = lerString(bruto.status);
    const uso: Record<string, unknown> = ehObjeto(bruto.usage)
      ? bruto.usage
      : {};

    const entrada =
      (lerNumero(uso.input_tokens) ?? 0) +
      (lerNumero(uso.cache_read_tokens) ?? 0);
    const duracaoMs = Math.round(
      (lerNumero(bruto.duration_seconds) ?? 0) * 1000,
    );

    if (status !== undefined && status !== 'SUCCESS') {
      return [
        {
          tipo: 'erro',
          codigo: 'agy_status_nao_sucesso',
          mensagem: `agy terminou com status ${status}`,
          retomavel: true,
        },
      ];
    }

    return [
      {
        tipo: 'fim',
        tokensEntrada: entrada,
        tokensSaida: lerNumero(uso.output_tokens) ?? 0,
        duracaoMs,
      },
    ];
  }
}

export function construirArgvAgy(
  pedido: PedidoGeracao,
  modelo: string,
  timeoutMs: number,
  prompt: string,
): string[] {
  const argv = [
    '-p',
    prompt,
    '--output-format',
    'stream-json',
    '--disable-slash-commands',
    '--print-timeout',
    `${Math.ceil(timeoutMs / 1000)}s`,
  ];

  if (modelo) {
    argv.push('--model', modelo);
  }

  return argv;
}
