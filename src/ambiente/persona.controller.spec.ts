import { BadRequestException } from '@nestjs/common';
import type { ConfiguracaoService } from '../config/configuracao.service';
import { RedactionService } from '../security/redaction.service';
import { TETO_DA_PERSONA } from '../engine/instrucao';
import { PersonaController } from './persona.controller';

function montar(personaAtual: string | null = null) {
  const definir = jest.fn((texto: string) => Promise.resolve(texto.trim()));
  const configuracao = {
    persona: () => Promise.resolve(personaAtual),
    definirPersona: definir,
  } as unknown as ConfiguracaoService;

  return {
    controller: new PersonaController(configuracao, new RedactionService()),
    definir,
  };
}

const requisicao = { usuario: { id: 'u1' } } as never;

describe('PersonaController', () => {
  it('lê a persona e informa o teto que o prompt aplica', async () => {
    const { controller } = montar('sou o oraculo do icaro');

    expect(await controller.ler()).toEqual({
      texto: 'sou o oraculo do icaro',
      teto: TETO_DA_PERSONA,
      mascaramentos: 0,
    });
  });

  it('grava a persona e devolve o que ficou', async () => {
    const { controller, definir } = montar();

    const saida = await controller.definir(
      { texto: '  nova persona  ' },
      requisicao,
    );

    expect(definir).toHaveBeenCalledWith('  nova persona  ', 'u1');
    expect(saida.texto).toBe('nova persona');
  });

  it('aceita texto vazio para apagar a persona', async () => {
    const { controller, definir } = montar('antiga');

    await controller.definir({ texto: '' }, requisicao);

    expect(definir).toHaveBeenCalledWith('', 'u1');
  });

  it('recusa corpo que não é objeto', async () => {
    const { controller } = montar();

    await expect(controller.definir('texto solto', requisicao)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('recusa texto que não é string', async () => {
    const { controller } = montar();

    await expect(controller.definir({ texto: 42 }, requisicao)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('ignora campo extra — só texto é aceito, para não abrir endereço aos blocos fixos', async () => {
    const { controller, definir } = montar();

    await controller.definir(
      { texto: 'persona', dadoInerte: 'tentativa de sobrescrever a defesa' },
      requisicao,
    );

    expect(definir).toHaveBeenCalledWith('persona', 'u1');
    expect(definir).toHaveBeenCalledTimes(1);
  });
});

describe('aviso de mascaramento', () => {
  it('conta o que será mascarado antes de ir ao provedor', async () => {
    const { controller } = montar(
      'me chame de icaro, meu email e fulano@empresa.com.br',
    );

    const resposta = await controller.ler();

    expect(resposta.mascaramentos).toBeGreaterThan(0);
    expect(resposta.texto).toContain('fulano@empresa.com.br');
  });

  it('persona limpa não reporta mascaramento', async () => {
    const { controller } = montar('responda curto e sem enfeite');

    expect((await controller.ler()).mascaramentos).toBe(0);
  });
});
