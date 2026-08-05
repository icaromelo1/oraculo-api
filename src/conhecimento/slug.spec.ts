import {
  gerarSlug,
  proximoSlug,
  slugDoNomeDeArquivo,
  slugSeguro,
  TAMANHO_MAXIMO_SLUG,
} from './slug';

describe('gerarSlug', () => {
  it('tira acento, cedilha e caixa alta', () => {
    expect(gerarSlug('Análise do Depósito Antecipado')).toBe(
      'analise-do-deposito-antecipado',
    );
    expect(gerarSlug('Configuração de Serviço')).toBe(
      'configuracao-de-servico',
    );
    expect(gerarSlug('ÁÉÍÓÚ Ãõ Çç')).toBe('aeiou-ao-cc');
  });

  it('colapsa espaço, pontuação e símbolo em um hífen só', () => {
    expect(gerarSlug('  nota   com    espaços  ')).toBe('nota-com-espacos');
    expect(gerarSlug('nota: parte 1 — final!')).toBe('nota-parte-1-final');
    expect(gerarSlug('a/b\\c')).toBe('a-b-c');
  });

  it('nunca devolve barra, ponto ou hífen nas pontas', () => {
    const slug = gerarSlug('...///---nota...///---');

    expect(slug).toBe('nota');
    expect(slug).not.toContain('/');
    expect(slug).not.toContain('.');
  });

  it('cai para "nota" quando o título não sobra nada utilizável', () => {
    expect(gerarSlug('...')).toBe('nota');
    expect(gerarSlug('   ')).toBe('nota');
    expect(gerarSlug('日本語')).toBe('nota');
  });

  it('trunca no teto sem deixar hífen sobrando', () => {
    const slug = gerarSlug('palavra '.repeat(40));

    expect(slug.length).toBeLessThanOrEqual(TAMANHO_MAXIMO_SLUG);
    expect(slug.endsWith('-')).toBe(false);
    expect(slugSeguro(slug)).toBe(true);
  });

  it('produz sempre um slug que passa em slugSeguro', () => {
    const titulos = [
      '../../etc/passwd',
      'C:\\Windows\\system32',
      '..',
      'nota;rm -rf /',
      '%2e%2e%2f',
    ];

    for (const titulo of titulos) {
      expect(slugSeguro(gerarSlug(titulo))).toBe(true);
    }
  });
});

describe('slugSeguro', () => {
  it('aceita só minúscula, número e hífen', () => {
    expect(slugSeguro('nota-1')).toBe(true);
    expect(slugSeguro('a')).toBe(true);
    expect(slugSeguro('2026-plano')).toBe(true);
  });

  it('recusa qualquer forma de path traversal', () => {
    expect(slugSeguro('..')).toBe(false);
    expect(slugSeguro('../etc/passwd')).toBe(false);
    expect(slugSeguro('../../../../etc/shadow')).toBe(false);
    expect(slugSeguro('nota/../outra')).toBe(false);
    expect(slugSeguro('sub/nota')).toBe(false);
    expect(slugSeguro('/etc/passwd')).toBe(false);
    expect(slugSeguro('nota\\..\\outra')).toBe(false);
    expect(slugSeguro('.nota')).toBe(false);
    expect(slugSeguro('nota.md')).toBe(false);
  });

  it('recusa caixa alta, vazio, hífen inicial e byte nulo', () => {
    expect(slugSeguro('Nota')).toBe(false);
    expect(slugSeguro('')).toBe(false);
    expect(slugSeguro('-nota')).toBe(false);
    expect(slugSeguro(`nota${String.fromCharCode(0)}.md`)).toBe(false);
  });

  it('recusa o que não é texto', () => {
    expect(slugSeguro(undefined)).toBe(false);
    expect(slugSeguro(null)).toBe(false);
    expect(slugSeguro(42)).toBe(false);
    expect(slugSeguro(['nota'])).toBe(false);
  });

  it('recusa slug acima do teto', () => {
    expect(slugSeguro('a'.repeat(TAMANHO_MAXIMO_SLUG))).toBe(true);
    expect(slugSeguro('a'.repeat(TAMANHO_MAXIMO_SLUG + 1))).toBe(false);
  });
});

describe('slugDoNomeDeArquivo', () => {
  it('ignora diretório e extensão do nome enviado', () => {
    expect(slugDoNomeDeArquivo('Notas de Reunião.md')).toBe('notas-de-reuniao');
    expect(slugDoNomeDeArquivo('arquivo.txt')).toBe('arquivo');
  });

  it('neutraliza nome de arquivo com traversal', () => {
    expect(slugDoNomeDeArquivo('../../etc/passwd.md')).toBe('passwd');
    expect(slugDoNomeDeArquivo('..\\..\\windows\\hosts.txt')).toBe('hosts');
    expect(slugDoNomeDeArquivo('/absoluto/nota.md')).toBe('nota');
  });
});

describe('proximoSlug', () => {
  it('mantém a base na primeira tentativa e sufixa nas seguintes', () => {
    expect(proximoSlug('nota', 1)).toBe('nota');
    expect(proximoSlug('nota', 2)).toBe('nota-2');
    expect(proximoSlug('nota', 17)).toBe('nota-17');
  });
});
