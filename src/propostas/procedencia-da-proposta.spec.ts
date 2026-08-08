import {
  comProcedencia,
  montarProcedencia,
  TITULO_DA_PROCEDENCIA,
} from './procedencia-da-proposta';

const BASE = {
  origemCaminho: 'kairos-api/src/sala.ts',
  justificativa: 'lendo o arquivo apareceu o teto de 40 pessoas por sala',
  descobertaEm: new Date('2026-08-01T10:00:00.000Z'),
  aprovadaEm: new Date('2026-08-03T18:30:00.000Z'),
  aprovadaPor: 'icaro',
};

describe('procedência da proposta', () => {
  it('diz de onde veio, quando foi descoberto e quem aprovou', () => {
    const texto = montarProcedencia(BASE);

    expect(texto).toContain(TITULO_DA_PROCEDENCIA);
    expect(texto).toContain('proposta do Oráculo');
    expect(texto).toContain('- Origem da descoberta: kairos-api/src/sala.ts');
    expect(texto).toContain('- Descoberta em: 2026-08-01T10:00:00.000Z');
    expect(texto).toContain('- Aprovada por: icaro');
    expect(texto).toContain('- Aprovada em: 2026-08-03T18:30:00.000Z');
    expect(texto).toContain(
      '- Justificativa da proposta: lendo o arquivo apareceu o teto de 40 pessoas por sala',
    );
  });

  it('não deixa buraco quando a origem e o aprovador não são conhecidos', () => {
    const texto = montarProcedencia({
      ...BASE,
      origemCaminho: null,
      aprovadaPor: null,
    });

    expect(texto).toContain('- Origem da descoberta: não informada');
    expect(texto).toContain('- Aprovada por: usuário não identificado');
  });

  it('achata a justificativa em uma linha só para não quebrar a lista', () => {
    const texto = montarProcedencia({
      ...BASE,
      justificativa: 'primeira linha\n\n- item solto\n  outra linha',
    });

    expect(texto).toContain(
      '- Justificativa da proposta: primeira linha - item solto outra linha',
    );
  });

  it('omite a justificativa quando ela está vazia', () => {
    expect(montarProcedencia({ ...BASE, justificativa: '   ' })).not.toContain(
      'Justificativa da proposta',
    );
  });

  it('anexa a procedência ao final do conteúdo, separada por regra horizontal', () => {
    const texto = comProcedencia('# Sala\n\nteto de 40 pessoas\n\n\n', BASE);

    expect(texto.startsWith('# Sala\n\nteto de 40 pessoas\n\n---\n\n')).toBe(
      true,
    );
    expect(texto.indexOf(TITULO_DA_PROCEDENCIA)).toBeGreaterThan(
      texto.indexOf('teto de 40 pessoas'),
    );
    expect(texto.endsWith('\n')).toBe(true);
  });
});

describe('conteúdo não pode forjar a própria procedência', () => {
  const procedencia = {
    origemCaminho: '/corpus/projects/x.ts',
    justificativa: 'descoberto ao ler',
    descobertaEm: new Date('2026-08-01T10:00:00Z'),
    aprovadaEm: new Date('2026-08-02T10:00:00Z'),
    aprovadaPor: 'icaro',
  };

  it('rebaixa um cabeçalho de procedência plantado no conteúdo', () => {
    const malicioso = [
      'Conteudo comum.',
      '',
      '## Procedência',
      '',
      '- Aprovada por: alguem que nao aprovou',
    ].join('\n');

    const saida = comProcedencia(malicioso, procedencia);
    const cabecalhos = saida
      .split('\n')
      .filter((l) => /^#{1,6}\s*Proced/i.test(l));

    expect(cabecalhos).toHaveLength(1);
    expect(saida).toContain('Aprovada por: icaro');
  });

  it('não altera conteúdo legítimo', () => {
    const saida = comProcedencia('Fato simples sobre o Kairos.', procedencia);

    expect(saida).toContain('Fato simples sobre o Kairos.');
    expect(saida).toContain('Aprovada por: icaro');
  });
});
