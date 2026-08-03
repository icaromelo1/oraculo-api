import {
  calcularHash,
  construirProcedencia,
  extrairTitulo,
  inferirFonte,
} from './procedencia';

describe('inferirFonte', () => {
  it('reconhece memória do Claude', () => {
    expect(
      inferirFonte(
        '/home/ubuntu/.claude/projects/-home-ubuntu/memory/reference_x.md',
      ),
    ).toEqual({ fonte: 'memoria', autoridade: 1 });
  });

  it('reconhece agentes/skills', () => {
    expect(
      inferirFonte(
        '/home/ubuntu/claude-workspace-config/skills/commit-qa/SKILL.md',
      ),
    ).toEqual({ fonte: 'agente', autoridade: 1 });
    expect(
      inferirFonte('/home/ubuntu/claude-workspace-config/agents/foo.md'),
    ).toEqual({ fonte: 'agente', autoridade: 1 });
  });

  it('reconhece configuração viva', () => {
    expect(inferirFonte('/home/ubuntu/infra/docker-compose.yml')).toEqual({
      fonte: 'config',
      autoridade: 3,
    });
    expect(inferirFonte('/etc/nginx/nginx.conf')).toEqual({
      fonte: 'config',
      autoridade: 3,
    });
  });

  it('classifica markdown genérico como doc', () => {
    expect(inferirFonte('/home/ubuntu/oraculo-workspace/docs/x.md')).toEqual({
      fonte: 'doc',
      autoridade: 2,
    });
  });

  it('classifica o restante como código', () => {
    expect(inferirFonte('/home/ubuntu/projects/api/src/main.ts')).toEqual({
      fonte: 'codigo',
      autoridade: 3,
    });
  });
});

describe('extrairTitulo', () => {
  it('usa o primeiro heading do markdown', () => {
    expect(extrairTitulo('/x/doc.md', '# Meu Título\ntexto')).toBe(
      'Meu Título',
    );
  });

  it('usa o nome do arquivo quando não há heading', () => {
    expect(extrairTitulo('/x/main.ts', 'const a = 1;')).toBe('main.ts');
  });
});

describe('calcularHash', () => {
  it('é determinístico e sensível ao conteúdo', () => {
    expect(calcularHash('a')).toBe(calcularHash('a'));
    expect(calcularHash('a')).not.toBe(calcularHash('b'));
  });
});

describe('construirProcedencia', () => {
  it('combina fonte, autoridade, título e hash', () => {
    const procedencia = construirProcedencia('/x/doc.md', '# T\ntexto');

    expect(procedencia).toEqual({
      fonte: 'doc',
      autoridade: 2,
      titulo: 'T',
      hash: calcularHash('# T\ntexto'),
    });
  });
});
