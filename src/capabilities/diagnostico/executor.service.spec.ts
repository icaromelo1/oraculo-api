jest.mock('node:child_process');

import { spawn } from 'node:child_process';
import {
  ExecutorDiagnostico,
  TETO_DE_SAIDA_BYTES,
  TIMEOUT_DIAGNOSTICO_MS,
} from './executor.service';
import { criarProcessoFalso, type ProcessoFalso } from './processo-falso';

const spawnFalso = spawn as unknown as jest.Mock;

function prepararProcesso(): ProcessoFalso {
  const processo = criarProcessoFalso();

  spawnFalso.mockReturnValue(processo);

  return processo;
}

describe('ExecutorDiagnostico', () => {
  beforeEach(() => {
    spawnFalso.mockReset();
  });

  it('monta spawn com array de argumentos, sem shell, sem stdin e com env mínimo', async () => {
    const executor = new ExecutorDiagnostico(() => '/usr/bin/docker');
    const processo = prepararProcesso();
    const promessa = executor.executar('docker', [
      'ps',
      '--format',
      '{{.Names}}',
    ]);

    processo.stdout.emit('data', Buffer.from('oraculo-api\n'));
    processo.emit('close', 0);

    const resultado = await promessa;

    expect(resultado).toEqual({
      ok: true,
      saida: 'oraculo-api\n',
      truncada: false,
      erro: null,
    });

    const [caminho, argumentos, opcoes] = (
      spawnFalso.mock.calls as unknown[][]
    )[0] as [string, string[], Record<string, unknown>];

    expect(caminho).toBe('/usr/bin/docker');
    expect(Array.isArray(argumentos)).toBe(true);
    expect(argumentos).toEqual(['ps', '--format', '{{.Names}}']);
    expect(opcoes.shell).toBe(false);
    expect(opcoes.stdio).toEqual(['ignore', 'pipe', 'pipe']);
    expect(opcoes.env).toEqual({
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      LANG: 'C',
      LC_ALL: 'C',
    });
  });

  it('não repassa o process.env do Oráculo para o comando', async () => {
    process.env.SEGREDO_DO_ORACULO = 'nao-pode-vazar';

    const executor = new ExecutorDiagnostico(() => '/usr/bin/docker');
    const processo = prepararProcesso();
    const promessa = executor.executar('docker', ['ps']);

    processo.emit('close', 0);
    await promessa;

    const opcoes = (spawnFalso.mock.calls as unknown[][])[0][2] as {
      env: Record<string, string>;
    };

    expect(opcoes.env.SEGREDO_DO_ORACULO).toBeUndefined();
    expect(Object.keys(opcoes.env).sort()).toEqual(['LANG', 'LC_ALL', 'PATH']);

    delete process.env.SEGREDO_DO_ORACULO;
  });

  it('junta stdout e stderr, porque docker logs escreve nos dois', async () => {
    const executor = new ExecutorDiagnostico(() => '/usr/bin/docker');
    const processo = prepararProcesso();
    const promessa = executor.executar('docker', ['logs', 'web']);

    processo.stdout.emit('data', Buffer.from('linha de stdout\n'));
    processo.stderr.emit('data', Buffer.from('linha de stderr\n'));
    processo.emit('close', 0);

    const resultado = await promessa;

    expect(resultado.saida).toBe('linha de stdout\nlinha de stderr\n');
  });

  it('nem chama spawn quando o binário não existe na máquina', async () => {
    const executor = new ExecutorDiagnostico(() => null);
    const resultado = await executor.executar('ss', ['-ltnp']);

    expect(spawnFalso).not.toHaveBeenCalled();
    expect(resultado.ok).toBe(false);
    expect(resultado.erro).toBe(
      'o binário "ss" não está disponível nesta máquina',
    );
  });

  it('trata saída diferente de zero sem stack trace nem caminho interno', async () => {
    const executor = new ExecutorDiagnostico(() => '/usr/bin/docker');
    const processo = prepararProcesso();
    const promessa = executor.executar('docker', ['inspect', 'web']);

    processo.stderr.emit(
      'data',
      Buffer.from(
        'Error: No such object: web\nat /opt/oraculo/src/interno.js:12\n',
      ),
    );
    processo.emit('close', 1);

    const resultado = await promessa;

    expect(resultado.ok).toBe(false);
    expect(resultado.erro).toBe(
      '"docker" terminou com código 1: Error: No such object: web',
    );
    expect(resultado.erro).not.toContain('/opt/oraculo');
  });

  it('apaga caminho absoluto que apareça na primeira linha do erro', async () => {
    const executor = new ExecutorDiagnostico(() => '/usr/bin/docker');
    const processo = prepararProcesso();
    const promessa = executor.executar('docker', ['ps']);

    processo.stderr.emit(
      'data',
      Buffer.from('cannot connect to /var/run/docker.sock\n'),
    );
    processo.emit('close', 125);

    const resultado = await promessa;

    expect(resultado.erro).toBe(
      '"docker" terminou com código 125: cannot connect to [caminho]',
    );
  });

  it('trata falha de spawn (evento error) como erro legível', async () => {
    const executor = new ExecutorDiagnostico(() => '/usr/bin/docker');
    const processo = prepararProcesso();
    const promessa = executor.executar('docker', ['ps']);

    processo.emit('error', new Error('spawn ENOENT /usr/bin/docker'));

    const resultado = await promessa;

    expect(resultado).toEqual({
      ok: false,
      saida: '',
      truncada: false,
      erro: 'não foi possível executar "docker"',
    });
  });

  it('trata exceção síncrona do spawn', async () => {
    spawnFalso.mockImplementation(() => {
      throw new Error('EACCES');
    });

    const executor = new ExecutorDiagnostico(() => '/usr/bin/docker');
    const resultado = await executor.executar('docker', ['ps']);

    expect(resultado.ok).toBe(false);
    expect(resultado.erro).toBe('não foi possível iniciar "docker"');
  });

  it('mata o processo e devolve erro quando estoura o tempo limite', async () => {
    jest.useFakeTimers();

    try {
      const executor = new ExecutorDiagnostico(() => '/usr/bin/docker');
      const processo = prepararProcesso();
      const promessa = executor.executar('docker', ['logs', 'web']);

      processo.stdout.emit('data', Buffer.from('parcial\n'));
      jest.advanceTimersByTime(TIMEOUT_DIAGNOSTICO_MS + 1);

      const resultado = await promessa;

      expect(processo.kill).toHaveBeenCalledWith('SIGKILL');
      expect(resultado.ok).toBe(false);
      expect(resultado.saida).toBe('parcial\n');
      expect(resultado.erro).toBe(
        '"docker" passou do tempo limite de 10s e foi encerrado',
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('ignora close atrasado depois do timeout', async () => {
    jest.useFakeTimers();

    try {
      const executor = new ExecutorDiagnostico(() => '/usr/bin/docker');
      const processo = prepararProcesso();
      const promessa = executor.executar('docker', ['logs', 'web']);

      jest.advanceTimersByTime(TIMEOUT_DIAGNOSTICO_MS + 1);
      processo.emit('close', 0);

      const resultado = await promessa;

      expect(resultado.ok).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('corta a saída gigante no teto de bytes e mata o processo', async () => {
    const executor = new ExecutorDiagnostico(() => '/usr/bin/docker');
    const processo = prepararProcesso();
    const promessa = executor.executar('docker', ['logs', 'web']);

    processo.stdout.emit('data', Buffer.alloc(TETO_DE_SAIDA_BYTES - 10, 0x61));
    processo.stdout.emit('data', Buffer.alloc(1_000_000, 0x62));
    processo.stdout.emit('data', Buffer.alloc(1_000_000, 0x63));
    processo.emit('close', null);

    const resultado = await promessa;

    expect(processo.kill).toHaveBeenCalledWith('SIGKILL');
    expect(resultado.ok).toBe(true);
    expect(resultado.truncada).toBe(true);
    expect(resultado.saida.endsWith('[saída cortada no teto de 256 KB]')).toBe(
      true,
    );
    expect(resultado.saida.length).toBeLessThanOrEqual(
      TETO_DE_SAIDA_BYTES + 40,
    );
    expect(resultado.saida).not.toContain('cccc');
  });

  it('recusa argumento que não é texto antes de chegar no spawn', async () => {
    const executor = new ExecutorDiagnostico(() => '/usr/bin/docker');
    const resultado = await executor.executar('docker', [
      'ps',
      undefined as unknown as string,
    ]);

    expect(spawnFalso).not.toHaveBeenCalled();
    expect(resultado.ok).toBe(false);
    expect(resultado.erro).toBe('argumento inválido montado para "docker"');
  });
});

describe('ambiente do processo filho', () => {
  const original = process.env.DOCKER_HOST;

  beforeEach(() => {
    spawnFalso.mockReset();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.DOCKER_HOST;
    else process.env.DOCKER_HOST = original;
  });

  it('repassa DOCKER_HOST válido, senão o cliente docker cai no socket inexistente', async () => {
    process.env.DOCKER_HOST = 'tcp://oraculo-docker:2375';

    const executor = new ExecutorDiagnostico(() => '/usr/bin/docker');
    const processo = prepararProcesso();
    const promessa = executor.executar('docker', ['ps']);
    processo.emit('close', 0);
    await promessa;

    const opcoes = spawnFalso.mock.calls[0][2] as {
      env: Record<string, string>;
    };
    const env = opcoes.env;

    expect(env.DOCKER_HOST).toBe('tcp://oraculo-docker:2375');
    expect(Object.keys(env).sort()).toEqual([
      'DOCKER_HOST',
      'LANG',
      'LC_ALL',
      'PATH',
    ]);
  });

  it('recusa DOCKER_HOST malformado em vez de repassar', async () => {
    process.env.DOCKER_HOST = 'tcp://alvo;rm -rf /';

    const executor = new ExecutorDiagnostico(() => '/usr/bin/docker');
    const processo = prepararProcesso();
    const promessa = executor.executar('docker', ['ps']);
    processo.emit('close', 0);
    await promessa;

    const opcoes = spawnFalso.mock.calls[0][2] as {
      env: Record<string, string>;
    };
    const env = opcoes.env;

    expect(env.DOCKER_HOST).toBeUndefined();
  });

  it('não vaza segredo do processo pai para o filho', async () => {
    process.env.SEGREDO_DO_ORACULO = 'nao-pode-vazar';
    process.env.DOCKER_HOST = 'tcp://oraculo-docker:2375';

    const executor = new ExecutorDiagnostico(() => '/usr/bin/docker');
    const processo = prepararProcesso();
    const promessa = executor.executar('docker', ['ps']);
    processo.emit('close', 0);
    await promessa;

    const opcoes = spawnFalso.mock.calls[0][2] as {
      env: Record<string, string>;
    };
    const env = opcoes.env;

    expect(JSON.stringify(env)).not.toContain('nao-pode-vazar');
    delete process.env.SEGREDO_DO_ORACULO;
  });
});
