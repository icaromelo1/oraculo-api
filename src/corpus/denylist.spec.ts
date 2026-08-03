import { caminhoNegado } from './denylist';

describe('caminhoNegado', () => {
  const negadosPadrao = [
    'secrets*',
    '.env*',
    '*.key',
    '*.pem',
    '*.p12',
    'id_rsa*',
    '*token*',
    '*.sqlite',
    'dsg-workspace',
    'cast-workspace',
  ];

  it('nega arquivo cujo nome bate com secrets*', () => {
    expect(caminhoNegado('secrets.local.md', negadosPadrao)).toBe(true);
  });

  it('nega arquivo dentro de um subdiretório com nome negado, não só o nome do arquivo', () => {
    expect(caminhoNegado('dsg-workspace/algum-doc.md', negadosPadrao)).toBe(
      true,
    );
    expect(caminhoNegado('a/b/dsg-workspace/c/doc.md', negadosPadrao)).toBe(
      true,
    );
  });

  it('nega arquivos .env em qualquer profundidade', () => {
    expect(caminhoNegado('.env', negadosPadrao)).toBe(true);
    expect(caminhoNegado('config/.env.local', negadosPadrao)).toBe(true);
  });

  it('nega chaves e certificados', () => {
    expect(caminhoNegado('id_rsa', negadosPadrao)).toBe(true);
    expect(caminhoNegado('certs/server.key', negadosPadrao)).toBe(true);
    expect(caminhoNegado('certs/server.pem', negadosPadrao)).toBe(true);
  });

  it('nega qualquer segmento que contenha "token"', () => {
    expect(caminhoNegado('auth/github-token.json', negadosPadrao)).toBe(true);
  });

  it('não nega caminhos legítimos', () => {
    expect(caminhoNegado('README.md', negadosPadrao)).toBe(false);
    expect(caminhoNegado('infra/docker-compose.yml', negadosPadrao)).toBe(
      false,
    );
    expect(
      caminhoNegado('claude-workspace-config/skills/commit.md', negadosPadrao),
    ).toBe(false);
  });

  it('é case-insensitive', () => {
    expect(caminhoNegado('SECRETS.LOCAL.MD', negadosPadrao)).toBe(true);
  });
});
