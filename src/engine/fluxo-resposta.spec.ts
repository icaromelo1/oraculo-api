import { RedactionService } from '../security/redaction.service';
import { FluxoResposta, JANELA } from './fluxo-resposta';

const redacao = new RedactionService();
const redigir = (texto: string) => redacao.redigir(texto);

function encher(tamanho: number): string {
  return 'lorem ipsum dolor sit amet consectetur '
    .repeat(Math.ceil(tamanho / 39))
    .slice(0, tamanho);
}

function correr(
  fragmentos: string[],
  validos: ReadonlySet<string> = new Set(),
): { fluxo: FluxoResposta; deltas: string[]; texto: string } {
  const fluxo = new FluxoResposta(redigir, validos);
  const deltas: string[] = [];

  for (const fragmento of fragmentos) {
    const parte = fluxo.empurrar(fragmento);

    if (parte) {
      deltas.push(parte);
    }
  }

  const resto = fluxo.encerrar();

  if (resto) {
    deltas.push(resto);
  }

  return { fluxo, deltas, texto: deltas.join('') };
}

describe('FluxoResposta', () => {
  it('nao libera nada antes de a janela encher', () => {
    const fluxo = new FluxoResposta(redigir, new Set());

    expect(fluxo.empurrar(encher(JANELA))).toBe('');
    expect(fluxo.encerrar()).toBe(encher(JANELA));
  });

  it('segura segredo partido entre dois deltas e nunca emite o valor cru', () => {
    const { deltas, texto } = correr([
      encher(300),
      'senha=segredoSuper',
      'Secreto123 e segue o texto. ',
      encher(400),
    ]);

    for (const delta of deltas) {
      expect(delta).not.toContain('segredoSuper');
      expect(delta).not.toContain('Secreto123');
    }

    expect(texto).toContain('senha=[oculto:senha]');
    expect(texto).not.toContain('segredoSuperSecreto123');
    expect(texto).toContain('e segue o texto.');
  });

  it('segura token partido em tres deltas', () => {
    const { deltas, texto } = correr([
      encher(300),
      'Authorization: Bearer ey',
      'JhbGciOiJIUzI1NiIsInR5',
      'cCI6IkpXVCJ9 fim do trecho. ',
      encher(400),
    ]);

    for (const delta of deltas) {
      expect(delta).not.toContain('JhbGciOiJIUzI1NiIs');
    }

    expect(texto).toContain('Authorization: Bearer [oculto:token]');
    expect(texto).toContain('fim do trecho.');
  });

  it('segura bloco de chave privada ate o fechamento chegar', () => {
    const { deltas, texto } = correr([
      encher(300),
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA',
      encher(400),
      'QWERTYUIOP\n-----END RSA PRIVATE KEY-----',
      encher(400),
    ]);

    for (const delta of deltas) {
      expect(delta).not.toContain('MIIEowIBAAKCAQEA');
    }

    expect(texto).toContain('[oculto:chave_privada]');
    expect(texto).not.toContain('QWERTYUIOP');
  });

  it('nao corta marcador de citacao ao meio', () => {
    const validos = new Set(['abc123abc123']);
    const { deltas } = correr(
      [encher(300), '[[F:abc1', '23abc123]] segue. ', encher(400)],
      validos,
    );

    for (const delta of deltas) {
      expect(delta).not.toMatch(/\[\[F:abc1$/);
    }

    expect(deltas.join('')).toContain('[[F:abc123abc123]]');
  });

  it('remove marcador que nao corresponde a fonte emitida', () => {
    const { texto } = correr(
      ['O motor roda na VM [[F:inventado]] e cita [[F:valido00]].'],
      new Set(['valido00']),
    );

    expect(texto).toBe('O motor roda na VM  e cita [[F:valido00]].');
  });

  it('tira o bloco oraculo-tool do texto do usuario e guarda o pedido', () => {
    const { fluxo, texto } = correr([
      'Vou olhar o arquivo.\n',
      '```oracu',
      'lo-tool\n{"ferramenta":"ler_arquivo",',
      '"argumentos":{"caminho":"/repos/a.ts"}}\n',
      '```',
      '\npronto.',
    ]);

    expect(texto).toBe('Vou olhar o arquivo.\n\npronto.');
    expect(fluxo.blocos).toHaveLength(1);
    expect(JSON.parse(fluxo.blocos[0].trim())).toEqual({
      ferramenta: 'ler_arquivo',
      argumentos: { caminho: '/repos/a.ts' },
    });
  });

  it('fecha bloco sem cerca de fechamento no encerramento', () => {
    const { fluxo, texto } = correr([
      'olha so ',
      '```oraculo-tool\n{"ferramenta":"buscar_conhecimento"}',
    ]);

    expect(texto).toBe('olha so ');
    expect(fluxo.blocos).toHaveLength(1);
  });

  it('guarda dois pedidos no mesmo turno', () => {
    const { fluxo } = correr([
      '```oraculo-tool\n{"ferramenta":"a"}\n```\ne tambem\n```oraculo-tool\n{"ferramenta":"b"}\n```',
    ]);

    expect(fluxo.blocos).toHaveLength(2);
  });

  it('preserva o texto bruto com o bloco para devolver ao modelo', () => {
    const { fluxo } = correr([
      'antes ```oraculo-tool\n{"ferramenta":"a"}\n``` depois',
    ]);

    expect(fluxo.bruto).toContain('```oraculo-tool');
    expect(fluxo.texto).toBe('antes  depois');
  });
});
