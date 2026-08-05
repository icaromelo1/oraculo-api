import { BadRequestException } from '@nestjs/common';
import {
  POR_PAGINA_PADRAO,
  POR_PAGINA_TETO,
  validarListarDocumentosDto,
} from './listar-documentos.dto';

describe('validarListarDocumentosDto', () => {
  it('usa página 1 e o tamanho padrão quando nada é informado', () => {
    expect(validarListarDocumentosDto({})).toMatchObject({
      busca: undefined,
      pasta: undefined,
      recursivo: true,
      pagina: 1,
      porPagina: POR_PAGINA_PADRAO,
    });
  });

  it('sobrevive a query indefinida', () => {
    expect(validarListarDocumentosDto(undefined).pagina).toBe(1);
  });

  it('corta porPagina no teto de 100', () => {
    expect(validarListarDocumentosDto({ porPagina: '5000' }).porPagina).toBe(
      POR_PAGINA_TETO,
    );
    expect(validarListarDocumentosDto({ porPagina: '10' }).porPagina).toBe(10);
  });

  it('aceita página informada como texto', () => {
    expect(validarListarDocumentosDto({ pagina: '3' }).pagina).toBe(3);
  });

  it('recusa página ou porPagina que não sejam inteiros positivos', () => {
    for (const query of [
      { pagina: '0' },
      { pagina: '-1' },
      { pagina: '1.5' },
      { pagina: 'abc' },
      { porPagina: '0' },
      { porPagina: 'muitos' },
    ]) {
      expect(() => validarListarDocumentosDto(query)).toThrow(
        BadRequestException,
      );
    }
  });

  it('apara a busca e descarta busca só de espaço', () => {
    expect(validarListarDocumentosDto({ busca: '  deposito  ' }).busca).toBe(
      'deposito',
    );
    expect(validarListarDocumentosDto({ busca: '   ' }).busca).toBeUndefined();
  });

  it('aceita apenas as fontes conhecidas do corpus', () => {
    expect(validarListarDocumentosDto({ fonte: 'nota' }).fonte).toBe('nota');
    expect(validarListarDocumentosDto({ fonte: 'codigo' }).fonte).toBe(
      'codigo',
    );
    expect(() => validarListarDocumentosDto({ fonte: 'inventada' })).toThrow(
      BadRequestException,
    );
  });

  it('aceita autoridade de 1 a 4 e recusa fora do intervalo', () => {
    expect(validarListarDocumentosDto({ autoridade: '1' }).autoridade).toBe(1);
    expect(validarListarDocumentosDto({ autoridade: 4 }).autoridade).toBe(4);
    expect(validarListarDocumentosDto({}).autoridade).toBeUndefined();

    for (const autoridade of ['0', '5', '2.5', 'alta', {}]) {
      expect(() => validarListarDocumentosDto({ autoridade })).toThrow(
        BadRequestException,
      );
    }
  });
});

describe('filtro por pasta', () => {
  it('aceita caminho absoluto', () => {
    const dto = validarListarDocumentosDto({ pasta: '/home/ubuntu/projects' });

    expect(dto.pasta).toBe('/home/ubuntu/projects');
  });

  it('recusa caminho relativo', () => {
    expect(() => validarListarDocumentosDto({ pasta: 'projects' })).toThrow(
      BadRequestException,
    );
  });

  it('recusa travessia de diretório', () => {
    expect(() =>
      validarListarDocumentosDto({ pasta: '/home/ubuntu/../../etc' }),
    ).toThrow(BadRequestException);
  });

  it('ignora pasta vazia', () => {
    expect(validarListarDocumentosDto({ pasta: '   ' }).pasta).toBeUndefined();
  });
});

describe('modo recursivo', () => {
  it('é recursivo por padrão', () => {
    expect(validarListarDocumentosDto({}).recursivo).toBe(true);
  });

  it('aceita false como texto vindo da query', () => {
    expect(validarListarDocumentosDto({ recursivo: 'false' }).recursivo).toBe(
      false,
    );
  });

  it('recusa valor que não é booleano', () => {
    expect(() => validarListarDocumentosDto({ recursivo: 'talvez' })).toThrow(
      BadRequestException,
    );
  });
});
