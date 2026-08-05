import { AbridorDeSessao, SessaoBanco } from './conexao';
import { verificarSomenteLeitura } from './verificacao-alvo';

function sessaoQueResponde(linha: unknown[]): AbridorDeSessao {
  const sessao: SessaoBanco = {
    executar: jest.fn(() =>
      Promise.resolve({
        colunas: ['superusuario', 'graváveis'],
        linhas: [linha],
      }),
    ),
    encerrar: jest.fn(() => Promise.resolve()),
  };

  return () => Promise.resolve(sessao);
}

describe('verificação do alvo de banco — só entra usuário sem escrita', () => {
  it('aceita usuário sem nenhuma tabela gravável', async () => {
    const veredicto = await verificarSomenteLeitura(
      'postgres://x',
      ['public'],
      sessaoQueResponde([false, 0]),
    );

    expect(veredicto.somenteLeitura).toBe(true);
  });

  it('recusa superusuário mesmo sem tabela gravável', async () => {
    const veredicto = await verificarSomenteLeitura(
      'postgres://x',
      ['public'],
      sessaoQueResponde([true, 0]),
    );

    expect(veredicto.somenteLeitura).toBe(false);
    expect(veredicto.motivo).toContain('superusuário');
  });

  it('recusa quem pode escrever em qualquer tabela do schema', async () => {
    const veredicto = await verificarSomenteLeitura(
      'postgres://x',
      ['public'],
      sessaoQueResponde([false, 3]),
    );

    expect(veredicto.somenteLeitura).toBe(false);
    expect(veredicto.motivo).toContain('3 tabela(s)');
  });

  it('recusa quando não consegue conectar — sem conexão, sem garantia', async () => {
    const veredicto = await verificarSomenteLeitura(
      'postgres://x',
      ['public'],
      () => Promise.reject(new Error('password authentication failed')),
    );

    expect(veredicto.somenteLeitura).toBe(false);
    expect(veredicto.motivo).toContain('não consegui conectar');
  });

  it('recusa quando a consulta de privilégios falha', async () => {
    const encerrar = jest.fn(() => Promise.resolve());
    const sessao: SessaoBanco = {
      executar: jest.fn(() => Promise.reject(new Error('permission denied'))),
      encerrar,
    };

    const veredicto = await verificarSomenteLeitura(
      'postgres://x',
      ['public'],
      () => Promise.resolve(sessao),
    );

    expect(veredicto.somenteLeitura).toBe(false);
    expect(encerrar).toHaveBeenCalled();
  });

  it('encerra a sessão mesmo no caminho feliz', async () => {
    const encerrar = jest.fn(() => Promise.resolve());
    const sessao: SessaoBanco = {
      executar: jest.fn(() =>
        Promise.resolve({ colunas: [], linhas: [[false, 0]] }),
      ),
      encerrar,
    };

    await verificarSomenteLeitura('postgres://x', [], () =>
      Promise.resolve(sessao),
    );

    expect(encerrar).toHaveBeenCalled();
  });
});
