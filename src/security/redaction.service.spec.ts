import { userInfo } from 'os';
import { RedactionService } from './redaction.service';
import type { TipoSegredo } from './tipos';

describe('RedactionService', () => {
  const servico = new RedactionService();

  const tipos = (texto: string): TipoSegredo[] =>
    servico.redigir(texto).ocorrencias.map((ocorrencia) => ocorrencia.tipo);

  describe('mascara dado sensivel', () => {
    it('mascara CPF formatado e sem formatacao', () => {
      const resultado = servico.redigir(
        'o cliente 529.982.247-25 e o outro 52998224725 pediram acesso',
      );

      expect(resultado.texto).not.toContain('529.982.247-25');
      expect(resultado.texto).not.toContain('52998224725');
      expect(resultado.texto).toContain('[oculto:cpf]');
      expect(resultado.total).toBe(2);
      expect(resultado.ocorrencias).toEqual([{ tipo: 'cpf', quantidade: 2 }]);
    });

    it('mascara CNPJ formatado e sem formatacao', () => {
      const resultado = servico.redigir(
        'emitente 11.222.333/0001-81 e filial 11222333000181',
      );

      expect(resultado.texto).not.toContain('11.222.333/0001-81');
      expect(resultado.texto).not.toContain('11222333000181');
      expect(resultado.ocorrencias).toEqual([{ tipo: 'cnpj', quantidade: 2 }]);
    });

    it('mascara e-mail', () => {
      const resultado = servico.redigir(
        'chamar icarodmelof@gmail.com em caso de falha',
      );

      expect(resultado.texto).toBe('chamar [oculto:email] em caso de falha');
      expect(resultado.total).toBe(1);
    });

    it('mascara telefone com DDD, com +55 e celular solto', () => {
      const resultado = servico.redigir(
        'contatos: (92) 99123-4567, +55 92 99123-4567, 92 99123-4567, 99123-4567',
      );

      expect(resultado.texto).not.toMatch(/9912/);
      expect(resultado.ocorrencias).toEqual([
        { tipo: 'telefone', quantidade: 4 },
      ]);
    });

    it('mascara cartao de credito com e sem separador', () => {
      const resultado = servico.redigir(
        'pagou com 4111 1111 1111 1111 e depois com 5500005555555559',
      );

      expect(resultado.texto).not.toContain('4111');
      expect(resultado.texto).not.toContain('5500005555555559');
      expect(resultado.ocorrencias).toEqual([
        { tipo: 'cartao', quantidade: 2 },
      ]);
    });

    it('mascara bloco inteiro de chave privada', () => {
      const chave = [
        '-----BEGIN OPENSSH PRIVATE KEY-----',
        'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAAB',
        'AAAAMwAAAAtzc2gtZW5yYW5kb21ieXRlc2hlcmVub3RyZWFsAAAA',
        '-----END OPENSSH PRIVATE KEY-----',
      ].join('\n');

      const resultado = servico.redigir(`chave do deploy:\n${chave}\nfim`);

      expect(resultado.texto).toBe(
        'chave do deploy:\n[oculto:chave_privada]\nfim',
      );
      expect(resultado.ocorrencias).toEqual([
        { tipo: 'chave_privada', quantidade: 1 },
      ]);
    });

    it('mascara token em chave=valor, Bearer, JWT e prefixo conhecido', () => {
      const resultado = servico.redigir(
        [
          'ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789',
          'Authorization: Bearer abcdefghijklmnopqrstuvwxyz.0123456789',
          'jwt=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk',
          'github_token = ghp_0123456789abcdefghijklmnopqrstuvwxyz',
        ].join('\n'),
      );

      expect(resultado.texto).not.toContain('sk-ant');
      expect(resultado.texto).not.toContain('ghp_');
      expect(resultado.texto).not.toContain('eyJhbGciOiJIUzI1NiJ9');
      expect(resultado.texto).toContain('Bearer [oculto:token]');
      expect(tipos(resultado.texto)).toEqual([]);
      expect(resultado.total).toBeGreaterThanOrEqual(4);
    });

    it('mascara senha de arquivo de config e de URL de conexao', () => {
      const resultado = servico.redigir(
        [
          'database:',
          '  password: "s3nh4-do-postgres"',
          'DATABASE_URL=postgres://oraculo:s3nh4-do-postgres@localhost:5434/oraculo',
        ].join('\n'),
      );

      expect(resultado.texto).not.toContain('s3nh4-do-postgres');
      expect(resultado.texto).toContain('password: "[oculto:senha]"');
      expect(resultado.texto).toContain('postgres://oraculo:[oculto:senha]@');
      expect(resultado.texto).toContain('localhost:5434');
    });

    it('conta e classifica cada valor mascarado', () => {
      const resultado = servico.redigir(
        'cpf 529.982.247-25 e email icaro@exemplo.com.br e email dois teste@exemplo.com',
      );

      expect(resultado.total).toBe(3);
      expect(resultado.ocorrencias).toEqual([
        { tipo: 'cpf', quantidade: 1 },
        { tipo: 'email', quantidade: 2 },
      ]);
    });
  });

  describe('nao destroi texto tecnico legitimo', () => {
    it('preserva porta, id numerico, hash de commit e timestamp de migration', () => {
      const texto =
        'o oraculo-db sobe na porta 5434, o registro id 884213 quebrou no commit ' +
        '4f2a91b3c8e0d7a6 durante a migration 1785769323846 da versao 1.1.0';

      const resultado = servico.redigir(texto);

      expect(resultado.texto).toBe(texto);
      expect(resultado.total).toBe(0);
      expect(resultado.ocorrencias).toEqual([]);
    });

    it('preserva intervalo de anos, cidr, semver e numeros de linha', () => {
      const texto =
        'periodo 2026-2027, rede 10.0.0.0/8, node 24.18.1, linhas 1200-1240, ' +
        'timeout 120000 ms, lote de 15000 trechos';

      expect(servico.redigir(texto).total).toBe(0);
    });

    it('preserva sequencia numerica que nao passa nos digitos verificadores', () => {
      const texto = 'protocolo 12345678901 e nota fiscal 12345678901234';

      expect(servico.redigir(texto).total).toBe(0);
    });

    it('preserva url e host sem credencial', () => {
      const texto =
        'front em http://localhost:8080 e api em https://api.traceai.com.br/v1/opp';

      expect(servico.redigir(texto).total).toBe(0);
    });

    it('devolve texto vazio sem quebrar', () => {
      expect(servico.redigir('')).toEqual({
        texto: '',
        total: 0,
        ocorrencias: [],
      });
    });
  });

  describe('redigirDiagnostico', () => {
    const tiposDiagnostico = (texto: string): TipoSegredo[] =>
      servico
        .redigirDiagnostico(texto)
        .ocorrencias.map((ocorrencia) => ocorrencia.tipo);

    it('mascara IPv4 em qualquer posicao, preservando a porta', () => {
      const resultado = servico.redigirDiagnostico(
        'proxy escutando em 0.0.0.0:8080 e container em 172.17.0.2',
      );

      expect(resultado.texto).toBe(
        'proxy escutando em [oculto:ip]:8080 e container em [oculto:ip]',
      );
      expect(resultado.ocorrencias).toEqual([{ tipo: 'ip', quantidade: 2 }]);
    });

    it('mascara IPv6 completo e abreviado', () => {
      const resultado = servico.redigirDiagnostico(
        'rota via 2001:0db8:85a3:0000:0000:8a2e:0370:7334 e link-local fe80::1a2b:3c4d',
      );

      expect(resultado.texto).not.toContain('2001:0db8');
      expect(resultado.texto).not.toContain('fe80::1a2b:3c4d');
      expect(resultado.ocorrencias).toEqual([{ tipo: 'ip', quantidade: 2 }]);
    });

    it('mascara MAC address', () => {
      const resultado = servico.redigirDiagnostico(
        'interface docker0 com mac 02:42:ac:11:00:02 ativa',
      );

      expect(resultado.texto).toBe(
        'interface docker0 com mac [oculto:ip] ativa',
      );
    });

    it('mascara hostname externo (FQDN) preservando a porta', () => {
      const resultado = servico.redigirDiagnostico(
        'conectando em srv-01.interno.example.com:5432 para replicar',
      );

      expect(resultado.texto).toBe(
        'conectando em [oculto:host]:5432 para replicar',
      );
      expect(resultado.ocorrencias).toEqual([{ tipo: 'host', quantidade: 1 }]);
    });

    it('preserva 127.0.0.1 e localhost, que nao revelam topologia', () => {
      const resultado = servico.redigirDiagnostico(
        'front em localhost:8080 e api em 127.0.0.1:3000',
      );

      expect(resultado.texto).toBe(
        'front em localhost:8080 e api em 127.0.0.1:3000',
      );
      expect(resultado.total).toBe(0);
    });

    it('preserva o loopback IPv6 ::1', () => {
      const resultado = servico.redigirDiagnostico(
        'ligado em [::1]:9000 e tambem em ::1',
      );

      expect(resultado.texto).toBe('ligado em [::1]:9000 e tambem em ::1');
      expect(resultado.total).toBe(0);
    });

    it('mascara o coringa IPv6 (::) do docker ps e do ss, preservando a porta', () => {
      const resultado = servico.redigirDiagnostico(
        'porta mapeada :::5434->5432/tcp e escuta em [::]:80',
      );

      expect(resultado.texto).toBe(
        'porta mapeada [oculto:ip]:5434->5432/tcp e escuta em [oculto:ip]:80',
      );
      expect(resultado.ocorrencias).toEqual([{ tipo: 'ip', quantidade: 2 }]);
    });

    it('mascara caminho de home de outro usuario, preservando o do dono', () => {
      const dono = userInfo().username;
      const resultado = servico.redigirDiagnostico(
        `volume /home/${dono}/app:/app e outro em /home/outro/segredo.env`,
      );

      expect(resultado.texto).toBe(
        `volume /home/${dono}/app:/app e outro em /home/[oculto:host]/segredo.env`,
      );
      expect(resultado.ocorrencias).toEqual([{ tipo: 'host', quantidade: 1 }]);
    });

    it('preserva CIDR de documentacao (rede, nao endereco especifico)', () => {
      const resultado = servico.redigirDiagnostico(
        'rede docker 172.18.0.0/16 e rota ipv6 2001:db8::/32',
      );

      expect(resultado.total).toBe(0);
    });

    it('nao mascara semver, id numerico, porta solta, hash de commit, uuid e timestamp', () => {
      const texto =
        'versao 2.14.3 e 1.0.0-beta.2, porta 8080 sozinha, id 884213, ' +
        'commit 4f2a91b3c8e0d7a6, uuid 550e8400-e29b-41d4-a716-446655440000, ' +
        'timestamp 1785769323846';

      expect(servico.redigirDiagnostico(texto).total).toBe(0);
    });

    it('nao mascara nome de imagem com tag (parece host:porta e nao e)', () => {
      const texto =
        'IMAGE postgres:17-alpine node:24-slim redis:7.2.4 nginx:1.25.3-alpine';

      expect(servico.redigirDiagnostico(texto).total).toBe(0);
    });

    it('preserva nome de container, imagem, porta e uso de memoria/disco', () => {
      const linhaDocker =
        'a1b2c3d4e5f6   postgres:17-alpine   Up 3 days   oraculo-db';
      const linhaMemoria =
        'Mem:           7822        3011        1204         512        3607        4210';
      const linhaDisco = '/dev/sda1        40G   18G   20G  48% /';

      expect(servico.redigirDiagnostico(linhaDocker).texto).toBe(linhaDocker);
      expect(servico.redigirDiagnostico(linhaMemoria).texto).toBe(linhaMemoria);
      expect(servico.redigirDiagnostico(linhaDisco).texto).toBe(linhaDisco);
    });

    it('redigir continua sem os padroes de diagnostico (compatibilidade)', () => {
      const resultado = servico.redigir(
        'api externa https://api.traceai.com.br/v1/opp e ip 10.0.0.5',
      );

      expect(resultado.total).toBe(0);
    });

    it('e idempotente: redigir duas vezes da o mesmo resultado', () => {
      const texto =
        'servidor srv-01.interno.example.com:22, mac 02:42:ac:11:00:02, ' +
        'ip 172.17.0.2, ipv6 fe80::1a2b:3c4d, home /home/outro/app, ' +
        'coringa :::5434->5432/tcp';

      const primeira = servico.redigirDiagnostico(texto);
      const segunda = servico.redigirDiagnostico(primeira.texto);

      expect(segunda.texto).toBe(primeira.texto);
      expect(segunda.total).toBe(0);
      expect(primeira.total).toBeGreaterThan(0);
    });

    it('classifica cada tipo novo separadamente', () => {
      expect(tiposDiagnostico('ip 172.17.0.2')).toEqual(['ip']);
      expect(tiposDiagnostico('host srv-01.interno.example.com')).toEqual([
        'host',
      ]);
    });
  });
});
