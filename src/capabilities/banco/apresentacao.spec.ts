import {
  formatarSchema,
  formatarTabela,
  indicesMascarados,
  MASCARA,
  TAMANHO_MAXIMO_SAIDA,
  TAMANHO_MAXIMO_VALOR,
  textoDoValor,
} from './apresentacao';

describe('mascaramento por nome de coluna', () => {
  it('acha a coluna sem olhar a caixa nem espaços', () => {
    expect(
      indicesMascarados(['id', 'Senha', 'email'], ['SENHA', ' email ']),
    ).toEqual([1, 2]);
  });

  it('devolve vazio quando o alvo não tem coluna mascarada', () => {
    expect(indicesMascarados(['id', 'senha'], [])).toEqual([]);
  });

  it('não mascara coluna parecida', () => {
    expect(indicesMascarados(['senha_hash', 'senhas'], ['senha'])).toEqual([]);
  });

  it('troca o valor por [mascarado] e marca o cabeçalho', () => {
    const { texto } = formatarTabela(
      ['id', 'senha'],
      [
        [1, 'segredo-do-icaro'],
        [2, 'outro-segredo'],
      ],
      ['senha'],
    );

    expect(texto).not.toContain('segredo-do-icaro');
    expect(texto).not.toContain('outro-segredo');
    expect(texto).toContain(`senha=${MASCARA}`);
    expect(texto).toContain('senha (mascarada)');
    expect(texto).toContain('id=1');
  });

  it('mascara mesmo quando a coluna vem com caixa diferente do cadastro', () => {
    const { texto } = formatarTabela(
      ['ID', 'SeNhA'],
      [[1, 'segredo']],
      ['senha'],
    );

    expect(texto).not.toContain('segredo');
  });
});

describe('formatação de valor', () => {
  it('representa nulo, data, buffer e objeto sem quebrar linha', () => {
    expect(textoDoValor(null)).toBe('(nulo)');
    expect(textoDoValor(undefined)).toBe('(nulo)');
    expect(textoDoValor(new Date('2026-08-03T10:00:00.000Z'))).toBe(
      '2026-08-03T10:00:00.000Z',
    );
    expect(textoDoValor(Buffer.from('abc'))).toBe('(binário de 3 byte(s))');
    expect(textoDoValor({ a: 1 })).toBe('{"a":1}');
  });

  it('achata quebra de linha e tabulação, que romperiam o formato', () => {
    expect(textoDoValor('a\nb\tc\r\nd')).toBe('a b c d');
  });

  it('corta valor gigante', () => {
    const cortado = textoDoValor('x'.repeat(TAMANHO_MAXIMO_VALOR + 50));

    expect(cortado).toContain('[valor cortado]');
    expect(cortado.length).toBeLessThan(TAMANHO_MAXIMO_VALOR + 30);
  });
});

describe('teto de saída', () => {
  it('marca truncada quando a tabela passa do teto', () => {
    const linhas = Array.from({ length: 200 }, (_, indice) => [
      indice,
      'y'.repeat(400),
    ]);
    const formatada = formatarTabela(['id', 'texto'], linhas, []);

    expect(formatada.truncada).toBe(true);
    expect(formatada.texto).toContain('saída cortada');
    expect(formatada.texto.length).toBeLessThan(TAMANHO_MAXIMO_SAIDA + 100);
  });

  it('avisa quando não veio linha nenhuma', () => {
    expect(formatarTabela(['id'], [], []).texto).toContain('(nenhuma linha)');
  });
});

describe('descrição de schema', () => {
  const colunas = [
    {
      schema: 'public',
      tabela: 'usuario',
      coluna: 'id',
      tipo: 'uuid',
      aceitaNulo: false,
    },
    {
      schema: 'public',
      tabela: 'usuario',
      coluna: 'senha',
      tipo: 'text',
      aceitaNulo: true,
    },
    {
      schema: 'app',
      tabela: 'evento',
      coluna: 'nome',
      tipo: 'text',
      aceitaNulo: false,
    },
  ];

  it('agrupa por tabela e marca a coluna mascarada', () => {
    const { texto } = formatarSchema(colunas, ['senha']);

    expect(texto).toContain(
      'public.usuario: id uuid not null, senha text null (mascarada)',
    );
    expect(texto).toContain('app.evento: nome text not null');
    expect(texto).toContain('tabelas: 2');
  });

  it('avisa quando o usuário do banco não enxerga nada', () => {
    expect(formatarSchema([], []).texto).toContain('nenhuma tabela visível');
  });
});
