import { quebrarCodigo, quebrarDocumento, quebrarMarkdown } from './chunking';

describe('quebrarMarkdown', () => {
  it('quebra por seção (heading) e preserva a ordem', () => {
    const conteudo = [
      '# Título',
      'intro',
      '## Seção 1',
      'conteúdo da seção 1',
      '## Seção 2',
      'conteúdo da seção 2',
    ].join('\n');

    const trechos = quebrarMarkdown(conteudo, 1000, 0);

    expect(trechos).toHaveLength(3);
    expect(trechos.map((t) => t.ordem)).toEqual([0, 1, 2]);
    expect(trechos[0].texto).toContain('# Título');
    expect(trechos[1].texto).toContain('## Seção 1');
    expect(trechos[2].texto).toContain('## Seção 2');
  });

  it('registra linhaInicio/linhaFim corretos', () => {
    const conteudo = ['# A', 'linha 2', '# B', 'linha 4', 'linha 5'].join('\n');

    const trechos = quebrarMarkdown(conteudo, 1000, 0);

    expect(trechos[0]).toMatchObject({ linhaInicio: 1, linhaFim: 2 });
    expect(trechos[1]).toMatchObject({ linhaInicio: 3, linhaFim: 5 });
  });

  it('respeita o teto de caracteres, quebrando uma seção grande em múltiplos trechos', () => {
    const linhas = Array.from({ length: 20 }, (_, i) =>
      `linha ${i}`.padEnd(20, ' '),
    );
    const conteudo = ['# Seção única', ...linhas].join('\n');

    const trechos = quebrarMarkdown(conteudo, 100, 0);

    expect(trechos.length).toBeGreaterThan(1);
    trechos.forEach((trecho) => {
      expect(trecho.texto.length).toBeLessThanOrEqual(120);
    });
  });

  it('produz sobreposição entre trechos consecutivos quando configurada', () => {
    const linhas = Array.from({ length: 10 }, (_, i) => `linha-${i}`);
    const conteudo = ['# Seção', ...linhas].join('\n');

    const trechos = quebrarMarkdown(conteudo, 40, 20);

    expect(trechos.length).toBeGreaterThan(1);
    expect(trechos[1].linhaInicio).toBeLessThanOrEqual(trechos[0].linhaFim);
  });
});

describe('quebrarCodigo', () => {
  it('quebra em blocos de linhas com faixa registrada', () => {
    const linhas = Array.from({ length: 25 }, (_, i) => `const x${i} = ${i};`);
    const conteudo = linhas.join('\n');

    const trechos = quebrarCodigo(conteudo, 10, 2);

    expect(trechos.length).toBeGreaterThan(1);
    expect(trechos[0]).toMatchObject({
      ordem: 0,
      linhaInicio: 1,
      linhaFim: 10,
    });
    expect(trechos[1].linhaInicio).toBeLessThanOrEqual(trechos[0].linhaFim);
  });

  it('cobre o arquivo inteiro sem lacunas', () => {
    const linhas = Array.from({ length: 15 }, (_, i) => `linha ${i}`);
    const conteudo = linhas.join('\n');

    const trechos = quebrarCodigo(conteudo, 5, 1);
    const ultimo = trechos[trechos.length - 1];

    expect(ultimo.linhaFim).toBe(15);
  });

  it('arquivo pequeno vira um único trecho', () => {
    const conteudo = 'const a = 1;\nconst b = 2;';
    const trechos = quebrarCodigo(conteudo, 80, 8);

    expect(trechos).toHaveLength(1);
    expect(trechos[0]).toMatchObject({ linhaInicio: 1, linhaFim: 2 });
  });
});

describe('quebrarDocumento', () => {
  it('escolhe quebra por markdown para .md', () => {
    const conteudo = '# Título\ntexto';
    const trechos = quebrarDocumento('/x/doc.md', conteudo);

    expect(trechos).toHaveLength(1);
    expect(trechos[0].texto).toContain('# Título');
  });

  it('escolhe quebra por código para outras extensões', () => {
    const conteudo = 'FROM node:24\nRUN npm ci\n';
    const trechos = quebrarDocumento('/x/Dockerfile', conteudo);

    expect(trechos).toHaveLength(1);
  });

  it('devolve vazio para conteúdo vazio', () => {
    expect(quebrarDocumento('/x/doc.md', '')).toEqual([]);
  });
});
