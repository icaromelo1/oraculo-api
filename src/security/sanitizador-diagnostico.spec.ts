import { userInfo } from 'os';
import { RedactionService } from './redaction.service';
import { SanitizadorDiagnostico } from './sanitizador-diagnostico';

describe('SanitizadorDiagnostico', () => {
  const sanitizador = new SanitizadorDiagnostico(new RedactionService());

  describe('docker ps', () => {
    const bruto = [
      'CONTAINER ID   IMAGE                COMMAND                  STATUS        PORTS                                          NAMES',
      'a1b2c3d4e5f6   postgres:17-alpine   "docker-entrypoint.s…"   Up 3 days     0.0.0.0:5434->5432/tcp, :::5434->5432/tcp     oraculo-db',
      'f6e5d4c3b2a1   node:24-slim         "node dist/main.js"      Up 2 hours    0.0.0.0:3000->3000/tcp                        oraculo-api',
    ].join('\n');

    it('mascara os IPs mas preserva porta, imagem com tag e nome do container', () => {
      const resultado = sanitizador.sanitizar(bruto);

      expect(resultado.texto).not.toContain('0.0.0.0');
      expect(resultado.texto).not.toContain(':::5434');
      expect(resultado.texto).toContain('[oculto:ip]:5434->5432/tcp');
      expect(resultado.texto).toContain('[oculto:ip]:3000->3000/tcp');
      expect(resultado.texto).toContain('postgres:17-alpine');
      expect(resultado.texto).toContain('node:24-slim');
      expect(resultado.texto).toContain('oraculo-db');
      expect(resultado.texto).toContain('oraculo-api');
      expect(resultado.texto).toContain('Up 3 days');
      expect(resultado.ocorrencias).toEqual([{ tipo: 'ip', quantidade: 3 }]);
    });
  });

  describe('ss -ltnp', () => {
    const bruto = [
      'State   Recv-Q  Send-Q  Local Address:Port    Peer Address:Port  Process',
      'LISTEN  0       4096    127.0.0.1:5434         0.0.0.0:*          users:(("docker-proxy",pid=1234,fd=7))',
      'LISTEN  0       511     172.18.0.4:5432        0.0.0.0:*          users:(("postgres",pid=2222,fd=3))',
      'LISTEN  0       128     [::]:80                [::]:*             users:(("nginx",pid=5678,fd=6))',
      'LISTEN  0       128     [::1]:9000             [::]:*             users:(("oraculo-api",pid=9999,fd=6))',
    ].join('\n');

    it('mascara enderecos que revelam topologia, preserva porta, loopback e nome de processo', () => {
      const resultado = sanitizador.sanitizar(bruto);

      expect(resultado.texto).not.toContain('172.18.0.4');
      expect(resultado.texto).not.toMatch(/\[::\]/);
      expect(resultado.texto).toContain('127.0.0.1:5434');
      expect(resultado.texto).toContain('[::1]:9000');
      expect(resultado.texto).toContain('[oculto:ip]:5432');
      expect(resultado.texto).toContain('[oculto:ip]:80');
      expect(resultado.texto).toContain('docker-proxy');
      expect(resultado.texto).toContain('postgres');
      expect(resultado.texto).toContain('nginx');
      expect(resultado.texto).toContain('oraculo-api');
      expect(resultado.texto).toContain('pid=1234');
    });
  });

  describe('docker logs', () => {
    const dono = userInfo().username;
    const bruto = [
      '2026-08-03T10:15:22.123Z [info] oraculo-api iniciado na porta 3000',
      '2026-08-03T10:15:23.456Z [info] conectando ao banco em oraculo-db:5432',
      '2026-08-03T10:15:24.001Z [warn] retry para srv-01.interno.example.com:22 falhou',
      '2026-08-03T10:15:25.789Z [error] falha ao alcançar 10.0.0.5, cliente 172.17.0.9 desconectado',
      '2026-08-03T10:15:26.000Z [info] lendo config.yml e .env do projeto',
      `2026-08-03T10:15:27.000Z [info] volume montado em /home/${dono}/oraculo-api e /home/outrousuario/scripts`,
    ].join('\n');

    it('mascara host/ip do log, preserva timestamp, nivel, porta e nomes de arquivo', () => {
      const resultado = sanitizador.sanitizar(bruto);

      expect(resultado.texto).not.toContain('srv-01.interno.example.com');
      expect(resultado.texto).not.toContain('10.0.0.5');
      expect(resultado.texto).not.toContain('172.17.0.9');
      expect(resultado.texto).not.toContain('outrousuario');
      expect(resultado.texto).toContain('2026-08-03T10:15:22.123Z');
      expect(resultado.texto).toContain('[info]');
      expect(resultado.texto).toContain('porta 3000');
      expect(resultado.texto).toContain('oraculo-db:5432');
      expect(resultado.texto).toContain('config.yml');
      expect(resultado.texto).toContain('.env');
      expect(resultado.texto).toContain(`/home/${dono}/oraculo-api`);
      expect(resultado.texto).toContain('/home/[oculto:host]/scripts');
    });
  });

  describe('free -m', () => {
    const bruto = [
      '              total        used        free      shared  buff/cache   available',
      'Mem:           7822        3011        1204         512        3607        4210',
      'Swap:          2048           0        2048',
    ].join('\n');

    it('nao mascara nada, uso de memoria continua legivel', () => {
      const resultado = sanitizador.sanitizar(bruto);

      expect(resultado.texto).toBe(bruto);
      expect(resultado.ocorrencias).toEqual([]);
    });
  });

  describe('df -h', () => {
    const bruto = [
      'Filesystem      Size  Used Avail Use% Mounted on',
      '/dev/sda1        40G   18G   20G  48% /',
      '/dev/sdb1       100G   42G   53G  45% /var/lib/docker',
    ].join('\n');

    it('nao mascara nada, uso de disco continua legivel', () => {
      const resultado = sanitizador.sanitizar(bruto);

      expect(resultado.texto).toBe(bruto);
      expect(resultado.ocorrencias).toEqual([]);
    });
  });

  describe('falsos positivos conhecidos', () => {
    it('nao mascara semver, cidr de documentacao, id, hash, uuid e timestamp', () => {
      const bruto =
        'oraculo-api v2.14.3 (build 1.0.0-beta.2), rede docker 172.18.0.0/16, ' +
        'registro id 884213, commit 4f2a91b3c8e0d7a6, ' +
        'request-id 550e8400-e29b-41d4-a716-446655440000, timestamp 1785769323846';

      const resultado = sanitizador.sanitizar(bruto);

      expect(resultado.texto).toBe(bruto);
      expect(resultado.ocorrencias).toEqual([]);
    });

    it('nao mascara porta solta nem nome de imagem com tag', () => {
      const bruto =
        'porta 8080 exposta, imagens postgres:17-alpine, node:24-slim, redis:7.2.4';

      const resultado = sanitizador.sanitizar(bruto);

      expect(resultado.texto).toBe(bruto);
      expect(resultado.ocorrencias).toEqual([]);
    });
  });

  describe('segredos gerais continuam cobertos', () => {
    it('mascara token e senha que aparecam em variaveis de ambiente do container', () => {
      const bruto = [
        'DATABASE_URL=postgres://oraculo:s3nh4-do-postgres@oraculo-db:5432/oraculo',
        'ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789',
      ].join('\n');

      const resultado = sanitizador.sanitizar(bruto);

      expect(resultado.texto).not.toContain('s3nh4-do-postgres');
      expect(resultado.texto).not.toContain('sk-ant');
      expect(resultado.texto).toContain('oraculo-db:5432');
      expect(resultado.ocorrencias.map((o) => o.tipo).sort()).toEqual([
        'senha',
        'token',
      ]);
    });
  });

  describe('idempotencia', () => {
    it('sanitizar duas vezes da o mesmo resultado', () => {
      const bruto = [
        'a1b2c3d4e5f6   postgres:17-alpine   0.0.0.0:5434->5432/tcp   oraculo-db',
        'mac 02:42:ac:11:00:02, ipv6 fe80::1a2b:3c4d, host srv-01.interno.example.com',
        'home alheio /home/outrousuario/segredo.env',
      ].join('\n');

      const primeira = sanitizador.sanitizar(bruto);
      const segunda = sanitizador.sanitizar(primeira.texto);

      expect(segunda.texto).toBe(primeira.texto);
      expect(segunda.ocorrencias).toEqual([]);
      expect(primeira.ocorrencias.length).toBeGreaterThan(0);
    });
  });

  it('preserva o home do dono da instancia', () => {
    const dono = userInfo().username;
    const resultado = sanitizador.sanitizar(
      `volume mapeado em /home/${dono}/oraculo-api`,
    );

    expect(resultado.texto).toBe(`volume mapeado em /home/${dono}/oraculo-api`);
    expect(resultado.ocorrencias).toEqual([]);
  });
});
