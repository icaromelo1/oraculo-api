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
});
