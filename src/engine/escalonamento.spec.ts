import { decidirEscalonamento } from './escalonamento';

const COBERTURA_BOA = { citadas: 3, total: 3, semFonte: 0 };
const COBERTURA_SEM_CITACAO = { citadas: 0, total: 2, semFonte: 2 };

describe('decidirEscalonamento', () => {
  it('não escala quando a resposta se apoiou em fonte e citou', () => {
    expect(
      decidirEscalonamento({
        cobertura: COBERTURA_BOA,
        fontesRecuperadas: 6,
        texto: 'O agendamento está aguardando liberação. [[F:a1]]',
      }),
    ).toBeNull();
  });

  it('escala quando nenhuma busca devolveu trecho', () => {
    const saida = decidirEscalonamento({
      cobertura: { citadas: 0, total: 1, semFonte: 1 },
      fontesRecuperadas: 0,
      texto: 'Provavelmente é a rotina das 22h que muda esse status.',
    });

    expect(saida?.motivo).toBe('sem_fonte_recuperada');
  });

  it('escala quando houve fonte mas a resposta não citou nenhuma', () => {
    const saida = decidirEscalonamento({
      cobertura: COBERTURA_SEM_CITACAO,
      fontesRecuperadas: 4,
      texto: 'O depósito é reembolsado em três dias úteis.',
    });

    expect(saida?.motivo).toBe('resposta_sem_citacao');
  });

  it('respeita a recusa que o próprio modelo declarou, mesmo com fonte na mão', () => {
    const saida = decidirEscalonamento({
      cobertura: COBERTURA_BOA,
      fontesRecuperadas: 9,
      texto:
        'Achei material sobre reserva, mas não tenho conhecimento suficiente sobre esse caso. [[F:a1]]',
    });

    expect(saida?.motivo).toBe('assumido_pelo_modelo');
  });

  it('reconhece a frase sem acento e no meio do parágrafo', () => {
    const saida = decidirEscalonamento({
      cobertura: COBERTURA_BOA,
      fontesRecuperadas: 3,
      texto:
        'Nao tenho conhecimento suficiente para responder isso com segurança.',
    });

    expect(saida?.motivo).toBe('assumido_pelo_modelo');
  });

  it('turno sem resposta nenhuma é falha, não lacuna — não escala', () => {
    expect(
      decidirEscalonamento({
        cobertura: { citadas: 0, total: 0, semFonte: 0 },
        fontesRecuperadas: 0,
        texto: '   ',
      }),
    ).toBeNull();
  });

  it('resposta curta sem parágrafo citável não escala se houve fonte', () => {
    expect(
      decidirEscalonamento({
        cobertura: { citadas: 0, total: 0, semFonte: 0 },
        fontesRecuperadas: 5,
        texto: 'Sim.',
      }),
    ).toBeNull();
  });
});
