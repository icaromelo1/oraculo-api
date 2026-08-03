import { spawn } from 'node:child_process';

const TIMEOUT_MS = 15_000;
const TAMANHO_MAXIMO_SAIDA = 2_000_000;

export interface LinhaCasada {
  numero: number;
  texto: string;
}

export function executarGitGrep(cwd: string, padrao: string): Promise<string> {
  return new Promise((resolvePromise) => {
    let processo: ReturnType<typeof spawn>;

    try {
      processo = spawn(
        'git',
        ['grep', '-n', '-I', '--untracked', '-e', padrao],
        { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch {
      resolvePromise('');
      return;
    }

    let saida = '';
    let finalizado = false;

    const finalizar = (valor: string) => {
      if (finalizado) {
        return;
      }
      finalizado = true;
      clearTimeout(temporizador);
      resolvePromise(valor);
    };

    const temporizador = setTimeout(() => {
      processo.kill('SIGKILL');
      finalizar(saida);
    }, TIMEOUT_MS);

    processo.stdout?.on('data', (bloco: Buffer) => {
      if (saida.length < TAMANHO_MAXIMO_SAIDA) {
        saida += bloco.toString('utf8');
      }
    });

    processo.stderr?.on('data', () => undefined);

    processo.on('error', () => finalizar(''));

    processo.on('close', (codigo) => {
      finalizar(codigo === 0 || codigo === 1 ? saida : '');
    });
  });
}

export function analisarSaidaDoGrep(saida: string): Map<string, LinhaCasada[]> {
  const porArquivo = new Map<string, LinhaCasada[]>();

  for (const linha of saida.split('\n')) {
    if (!linha) {
      continue;
    }

    const primeiro = linha.indexOf(':');

    if (primeiro === -1) {
      continue;
    }

    const segundo = linha.indexOf(':', primeiro + 1);

    if (segundo === -1) {
      continue;
    }

    const caminho = linha.slice(0, primeiro);
    const numero = Number(linha.slice(primeiro + 1, segundo));

    if (!Number.isInteger(numero)) {
      continue;
    }

    const texto = linha.slice(segundo + 1);
    const lista = porArquivo.get(caminho) ?? [];
    lista.push({ numero, texto });
    porArquivo.set(caminho, lista);
  }

  return porArquivo;
}
