import { agruparLacunas, motivoDoTom } from './lacunas';

function linha(tom: string, pergunta: string, iso: string) {
  return { tom, pergunta, criadaEm: new Date(iso) };
}

describe('motivoDoTom', () => {
  it('extrai o motivo do tom escalonado', () => {
    expect(motivoDoTom('escalonado:sem_fonte_recuperada')).toBe(
      'sem_fonte_recuperada',
    );
  });

  it('ignora tom que não é escalonamento', () => {
    expect(motivoDoTom('bloqueio')).toBeNull();
    expect(motivoDoTom('ok')).toBeNull();
  });

  it('ignora escalonamento sem motivo', () => {
    expect(motivoDoTom('escalonado:')).toBeNull();
    expect(motivoDoTom('escalonado:   ')).toBeNull();
  });
});

describe('agruparLacunas', () => {
  it('agrupa por motivo e ordena pelo que mais aparece', () => {
    const saida = agruparLacunas([
      linha(
        'escalonado:sem_fonte_recuperada',
        'como funciona o reembolso?',
        '2026-08-09T10:00:00Z',
      ),
      linha(
        'escalonado:sem_fonte_recuperada',
        'quem paga a falta?',
        '2026-08-09T11:00:00Z',
      ),
      linha(
        'escalonado:resposta_sem_citacao',
        'qual o prazo do ASO?',
        '2026-08-09T09:00:00Z',
      ),
      linha('ok', 'pergunta respondida', '2026-08-09T12:00:00Z'),
    ]);

    expect(saida).toHaveLength(2);
    expect(saida[0].motivo).toBe('sem_fonte_recuperada');
    expect(saida[0].total).toBe(2);
    expect(saida[1].motivo).toBe('resposta_sem_citacao');
  });

  it('conta toda repetição mas mostra a pergunta uma vez só', () => {
    const saida = agruparLacunas([
      linha(
        'escalonado:sem_fonte_recuperada',
        'como funciona o reembolso?',
        '2026-08-09T10:00:00Z',
      ),
      linha(
        'escalonado:sem_fonte_recuperada',
        'Como Funciona o Reembolso?',
        '2026-08-09T11:00:00Z',
      ),
      linha(
        'escalonado:sem_fonte_recuperada',
        'como funciona o reembolso?',
        '2026-08-09T12:00:00Z',
      ),
    ]);

    expect(saida[0].total).toBe(3);
    expect(saida[0].perguntas).toEqual(['como funciona o reembolso?']);
  });

  it('mostra no máximo cinco exemplos por motivo', () => {
    const saida = agruparLacunas(
      Array.from({ length: 9 }, (_, i) =>
        linha(
          'escalonado:sem_fonte_recuperada',
          `pergunta ${i}`,
          `2026-08-09T1${i}:00:00Z`,
        ),
      ),
    );

    expect(saida[0].total).toBe(9);
    expect(saida[0].perguntas).toHaveLength(5);
  });

  it('a amostra traz as perguntas mais recentes', () => {
    const saida = agruparLacunas([
      linha(
        'escalonado:sem_fonte_recuperada',
        'antiga',
        '2026-08-01T10:00:00Z',
      ),
      linha(
        'escalonado:sem_fonte_recuperada',
        'recente',
        '2026-08-09T10:00:00Z',
      ),
    ]);

    expect(saida[0].perguntas[0]).toBe('recente');
    expect(saida[0].ultimaEm).toBe(
      new Date('2026-08-09T10:00:00Z').toISOString(),
    );
  });

  it('turno sem pergunta não vira exemplo, mas conta no total', () => {
    const saida = agruparLacunas([
      linha('escalonado:assumido_pelo_modelo', '   ', '2026-08-09T10:00:00Z'),
      linha(
        'escalonado:assumido_pelo_modelo',
        'uma pergunta',
        '2026-08-09T11:00:00Z',
      ),
    ]);

    expect(saida[0].total).toBe(2);
    expect(saida[0].perguntas).toEqual(['uma pergunta']);
  });

  it('sem escalonamento nenhum, devolve lista vazia', () => {
    expect(
      agruparLacunas([linha('ok', 'tudo certo', '2026-08-09T10:00:00Z')]),
    ).toEqual([]);
  });
});
