import { spawn } from 'node:child_process';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  resolverBinario,
  type NomeBinario,
  type ResolvedorBinario,
} from './catalogo';

export const RESOLVEDOR_BINARIO = Symbol('RESOLVEDOR_BINARIO');

export const TIMEOUT_DIAGNOSTICO_MS = 10_000;
export const TETO_DE_SAIDA_BYTES = 256 * 1024;

const AVISO_DE_CORTE = '\n[saída cortada no teto de 256 KB]';

const ENV_MINIMO: Readonly<Record<string, string>> = {
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  LANG: 'C',
  LC_ALL: 'C',
};

const ENDERECO_DOCKER = /^(tcp|unix):\/\/[A-Za-z0-9._\-/:]+$/;

function envDoProcesso(): Record<string, string> {
  const alvoDocker = process.env.DOCKER_HOST?.trim();

  if (alvoDocker && ENDERECO_DOCKER.test(alvoDocker)) {
    return { ...ENV_MINIMO, DOCKER_HOST: alvoDocker };
  }

  return { ...ENV_MINIMO };
}

const TAMANHO_DO_DETALHE = 200;

export interface ResultadoExecucao {
  ok: boolean;
  saida: string;
  truncada: boolean;
  erro: string | null;
}

function limparCaminhos(texto: string): string {
  return texto.replace(/(?:\/[A-Za-z0-9._-]+){2,}/g, '[caminho]');
}

@Injectable()
export class ExecutorDiagnostico {
  private readonly resolver: ResolvedorBinario;

  constructor(
    @Optional()
    @Inject(RESOLVEDOR_BINARIO)
    resolvedor?: ResolvedorBinario | null,
  ) {
    this.resolver = resolvedor ?? resolverBinario;
  }

  executar(
    binario: NomeBinario,
    argumentos: readonly string[],
  ): Promise<ResultadoExecucao> {
    if (argumentos.some((argumento) => typeof argumento !== 'string')) {
      return Promise.resolve(
        this.falha(`argumento inválido montado para "${binario}"`),
      );
    }

    const caminho = this.resolver(binario);

    if (!caminho) {
      return Promise.resolve(
        this.falha(`o binário "${binario}" não está disponível nesta máquina`),
      );
    }

    return new Promise<ResultadoExecucao>((concluir) => {
      let processo: ReturnType<typeof spawn>;

      try {
        processo = spawn(caminho, [...argumentos], {
          cwd: '/',
          env: envDoProcesso(),
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch {
        concluir(this.falha(`não foi possível iniciar "${binario}"`));

        return;
      }

      const partes: Buffer[] = [];
      let total = 0;
      let truncada = false;
      let finalizado = false;

      const montar = (): string => {
        const texto = Buffer.concat(partes).toString('utf8');

        return truncada ? `${texto}${AVISO_DE_CORTE}` : texto;
      };

      const finalizar = (resultado: ResultadoExecucao): void => {
        if (finalizado) {
          return;
        }

        finalizado = true;
        clearTimeout(temporizador);
        concluir(resultado);
      };

      const acumular = (bloco: Buffer): void => {
        if (truncada) {
          return;
        }

        const espaco = TETO_DE_SAIDA_BYTES - total;

        if (bloco.length > espaco) {
          partes.push(bloco.subarray(0, Math.max(espaco, 0)));
          total = TETO_DE_SAIDA_BYTES;
          truncada = true;
          processo.kill('SIGKILL');

          return;
        }

        partes.push(bloco);
        total += bloco.length;
      };

      const temporizador = setTimeout(() => {
        processo.kill('SIGKILL');
        finalizar({
          ok: false,
          saida: montar(),
          truncada,
          erro: `"${binario}" passou do tempo limite de ${
            TIMEOUT_DIAGNOSTICO_MS / 1000
          }s e foi encerrado`,
        });
      }, TIMEOUT_DIAGNOSTICO_MS);

      temporizador.unref?.();

      processo.stdout?.on('data', acumular);
      processo.stderr?.on('data', acumular);

      processo.on('error', () =>
        finalizar(this.falha(`não foi possível executar "${binario}"`)),
      );

      processo.on('close', (codigo) => {
        if (truncada) {
          finalizar({ ok: true, saida: montar(), truncada: true, erro: null });

          return;
        }

        if (codigo === 0) {
          finalizar({ ok: true, saida: montar(), truncada: false, erro: null });

          return;
        }

        finalizar({
          ok: false,
          saida: montar(),
          truncada: false,
          erro: this.detalhar(binario, codigo, montar()),
        });
      });
    });
  }

  private detalhar(
    binario: NomeBinario,
    codigo: number | null,
    saida: string,
  ): string {
    const base = `"${binario}" terminou com código ${codigo ?? 'desconhecido'}`;
    const primeira = saida
      .split('\n')
      .map((linha) => linha.trim())
      .find((linha) => linha.length > 0);

    if (!primeira) {
      return base;
    }

    return `${base}: ${limparCaminhos(primeira).slice(0, TAMANHO_DO_DETALHE)}`;
  }

  private falha(erro: string): ResultadoExecucao {
    return { ok: false, saida: '', truncada: false, erro };
  }
}
