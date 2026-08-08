import { BadRequestException } from '@nestjs/common';
import type { ConfiguracaoService } from '../config/configuracao.service';
import type { BibliotecaService } from './biblioteca.service';
import { ConhecimentoController } from './conhecimento.controller';
import type { ConhecimentoService } from './conhecimento.service';
import type { SugestaoDescricaoService } from './sugestao-descricao.service';

function montar() {
  const descrever = jest.fn((id: string, descricao: string) =>
    Promise.resolve({ id, descricao: descricao || null }),
  );
  const sugerir = jest.fn(() =>
    Promise.resolve({ sugestao: 'uma frase curta' }),
  );

  const controller = new ConhecimentoController(
    {} as unknown as ConhecimentoService,
    {} as unknown as BibliotecaService,
    { descreverDocumento: descrever } as unknown as ConfiguracaoService,
    { sugerir } as unknown as SugestaoDescricaoService,
  );

  return { controller, descrever, sugerir };
}

const requisicao = { usuario: { id: 'u1' } } as never;

describe('ConhecimentoController — descrição de documento', () => {
  it('salva a descrição informada', async () => {
    const { controller, descrever } = montar();

    await controller.descreverDocumento(
      'doc-1',
      { descricao: 'fato sobre o kairos' },
      requisicao,
    );

    expect(descrever).toHaveBeenCalledWith(
      'doc-1',
      'fato sobre o kairos',
      'u1',
    );
  });

  it('aceita descrição vazia para limpar', async () => {
    const { controller, descrever } = montar();

    await controller.descreverDocumento('doc-1', { descricao: '' }, requisicao);

    expect(descrever).toHaveBeenCalledWith('doc-1', '', 'u1');
  });

  it('trata corpo sem descrição como limpeza', async () => {
    const { controller, descrever } = montar();

    await controller.descreverDocumento('doc-1', {}, requisicao);

    expect(descrever).toHaveBeenCalledWith('doc-1', '', 'u1');
  });

  it('recusa corpo que não é objeto', () => {
    const { controller } = montar();

    expect(() =>
      controller.descreverDocumento('doc-1', 'texto solto', requisicao),
    ).toThrow(BadRequestException);
  });

  it('recusa array, que passa por typeof object', () => {
    const { controller } = montar();

    expect(() =>
      controller.descreverDocumento('doc-1', [], requisicao),
    ).toThrow(BadRequestException);
  });

  it('recusa descrição que não é texto', () => {
    const { controller } = montar();

    expect(() =>
      controller.descreverDocumento('doc-1', { descricao: 42 }, requisicao),
    ).toThrow(BadRequestException);
  });
});

describe('ConhecimentoController — sugestão de descrição', () => {
  it('repassa conteúdo e título validados ao serviço', async () => {
    const { controller, sugerir } = montar();

    await controller.sugerirDescricao({
      conteudo: 'texto do documento',
      titulo: '  guia do kairos  ',
    });

    expect(sugerir).toHaveBeenCalledWith({
      conteudo: 'texto do documento',
      titulo: 'guia do kairos',
    });
  });

  it('recusa conteúdo que não é texto', () => {
    const { controller } = montar();

    expect(() => controller.sugerirDescricao({ conteudo: 42 })).toThrow(
      BadRequestException,
    );
  });
});
