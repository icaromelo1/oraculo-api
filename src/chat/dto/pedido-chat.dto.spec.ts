import { BadRequestException } from '@nestjs/common';
import { validarPedidoChatDto } from './pedido-chat.dto';

describe('validarPedidoChatDto', () => {
  it('aceita o pedido mínimo, só com pergunta', () => {
    const dto = validarPedidoChatDto({
      pergunta: '  qual a porta do banco?  ',
    });

    expect(dto).toEqual({
      conversaId: undefined,
      pergunta: 'qual a porta do banco?',
      escopo: undefined,
    });
  });

  it('mantém conversaId quando informado', () => {
    const dto = validarPedidoChatDto({
      conversaId: 'c1',
      pergunta: 'oi',
    });

    expect(dto.conversaId).toBe('c1');
  });

  it('trata conversaId vazio como ausente', () => {
    const dto = validarPedidoChatDto({ conversaId: '   ', pergunta: 'oi' });

    expect(dto.conversaId).toBeUndefined();
  });

  it('valida e normaliza o escopo', () => {
    const dto = validarPedidoChatDto({
      pergunta: 'oi',
      escopo: { repositorios: ['oraculo-api'], alvos: [] },
    });

    expect(dto.escopo).toEqual({ repositorios: ['oraculo-api'], alvos: [] });
  });

  it('rejeita corpo que não é objeto', () => {
    expect(() => validarPedidoChatDto('oi')).toThrow(BadRequestException);
    expect(() => validarPedidoChatDto(null)).toThrow(BadRequestException);
  });

  it('rejeita pergunta ausente ou vazia', () => {
    expect(() => validarPedidoChatDto({})).toThrow(BadRequestException);
    expect(() => validarPedidoChatDto({ pergunta: '   ' })).toThrow(
      BadRequestException,
    );
  });

  it('rejeita conversaId que não é texto', () => {
    expect(() =>
      validarPedidoChatDto({ pergunta: 'oi', conversaId: 42 }),
    ).toThrow(BadRequestException);
  });

  it('rejeita escopo malformado', () => {
    expect(() =>
      validarPedidoChatDto({ pergunta: 'oi', escopo: 'tudo' }),
    ).toThrow(BadRequestException);
    expect(() =>
      validarPedidoChatDto({
        pergunta: 'oi',
        escopo: { repositorios: [1, 2] },
      }),
    ).toThrow(BadRequestException);
  });
});
