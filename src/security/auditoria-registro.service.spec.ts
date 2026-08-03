import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Auditoria } from '../database/entities';
import { AuditoriaRegistroService } from './auditoria-registro.service';

describe('AuditoriaRegistroService', () => {
  const create = jest.fn((dados: Partial<Auditoria>) => dados);
  const save = jest.fn((dados: Partial<Auditoria>) => Promise.resolve(dados));

  const repositorio = {
    create,
    save,
  } as unknown as Repository<Auditoria>;

  const servico = new AuditoriaRegistroService(repositorio);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('grava o bloqueio mesmo sem pergunta e sem modelo', async () => {
    await servico.registrarBloqueio({
      usuarioId: 'usuario-1',
      bloqueio: {
        capacidade: 'consultar_banco',
        decisao: 'bloquear',
        politica: 'escrita_no_banco',
        motivo: 'o Oraculo so executa consulta de leitura',
      },
    });
    const gravado = save.mock.calls[0][0];

    expect(gravado.usuario).toEqual({ id: 'usuario-1' });
    expect(gravado.tom).toBe('bloqueio');
    expect(gravado.duracaoMs).toBe(0);
    expect(gravado.fontes).toBe(0);
    expect(gravado.resultado).toContain('bloquear');
    expect(gravado.bloqueios).toEqual({
      itens: [
        {
          capacidade: 'consultar_banco',
          decisao: 'bloquear',
          politica: 'escrita_no_banco',
          motivo: 'o Oraculo so executa consulta de leitura',
        },
      ],
    });
  });

  it('grava o turno com ferramentas e bloqueios acumulados', async () => {
    await servico.registrarTurno({
      pergunta: 'quais servicos estao no ar?',
      ferramentas: [{ nome: 'buscar_conhecimento', status: 'concluida' }],
      bloqueios: [
        {
          capacidade: 'estado_servicos',
          decisao: 'bloquear',
          politica: 'comando_fora_da_allowlist',
          motivo: 'comando nao permitido',
        },
      ],
      fontes: 2,
      resultado: 'respondeu com ressalva',
      duracaoMs: 900,
      modelo: 'claude-haiku-4-5',
    });
    const gravado = save.mock.calls[0][0];

    expect(gravado.usuario).toBeNull();
    expect(gravado.tom).toBe('bloqueio_parcial');
    expect(gravado.fontes).toBe(2);
    expect(gravado.duracaoMs).toBe(900);
  });

  it('nao derruba o fluxo quando o banco falha', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    save.mockRejectedValueOnce(new Error('conexao recusada'));

    await expect(
      servico.registrarBloqueio({
        bloqueio: {
          capacidade: 'ler_arquivo',
          decisao: 'bloquear',
          politica: 'caminho_negado',
          motivo: 'arquivo negado',
        },
      }),
    ).resolves.toBeNull();
  });
});
