import { EventoProvedor } from './llm-provider';

const TENTATIVAS = 3;

async function* comRetentativa(
  rodadas: EventoProvedor[][],
  registro: { tentativas: number },
): AsyncIterable<EventoProvedor> {
  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    const ultima = tentativa === TENTATIVAS;
    const retidos: EventoProvedor[] = [];
    let fluindo = false;
    let houveErro = false;

    registro.tentativas = tentativa;

    const rodada = rodadas[Math.min(tentativa - 1, rodadas.length - 1)];

    for (const evento of rodada) {
      await Promise.resolve();

      if (fluindo) {
        yield evento;
        continue;
      }

      if (evento.tipo === 'erro') houveErro = true;

      const temConteudo =
        evento.tipo === 'texto' && evento.fragmento.trim() !== '';

      if (temConteudo || houveErro || ultima) {
        fluindo = true;
        for (const retido of retidos) yield retido;
        yield evento;
        continue;
      }

      retidos.push(evento);
    }

    if (fluindo) return;
  }
}

const fim: EventoProvedor = {
  tipo: 'fim',
  tokensEntrada: 0,
  tokensSaida: 0,
  duracaoMs: 1,
};

async function coletar(fluxo: AsyncIterable<EventoProvedor>) {
  const eventos: EventoProvedor[] = [];
  for await (const e of fluxo) eventos.push(e);
  return eventos;
}

describe('resposta vazia do provedor é retentada', () => {
  it('repete quando a rodada não produz texto e entrega a seguinte', async () => {
    const registro = { tentativas: 0 };
    const eventos = await coletar(
      comRetentativa(
        [[fim], [{ tipo: 'texto', fragmento: 'resposta boa' }, fim]],
        registro,
      ),
    );

    expect(registro.tentativas).toBe(2);
    expect(eventos.some((e) => e.tipo === 'texto')).toBe(true);
  });

  it('não repete quando a primeira rodada já respondeu', async () => {
    const registro = { tentativas: 0 };
    await coletar(
      comRetentativa([[{ tipo: 'texto', fragmento: 'ok' }, fim]], registro),
    );

    expect(registro.tentativas).toBe(1);
  });

  it('não repete quando o provedor devolveu erro', async () => {
    const registro = { tentativas: 0 };
    const eventos = await coletar(
      comRetentativa(
        [
          [
            {
              tipo: 'erro',
              codigo: 'cli_timeout',
              mensagem: 'estourou',
              retomavel: true,
            },
          ],
        ],
        registro,
      ),
    );

    expect(registro.tentativas).toBe(1);
    expect(eventos[0].tipo).toBe('erro');
  });

  it('desiste depois do teto e entrega o que veio', async () => {
    const registro = { tentativas: 0 };
    const eventos = await coletar(comRetentativa([[fim]], registro));

    expect(registro.tentativas).toBe(TENTATIVAS);
    expect(eventos).toHaveLength(1);
  });
});
