import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';

jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn(),
  rm: jest.fn(),
  stat: jest.fn(),
  writeFile: jest.fn(),
}));

jest.mock('unpdf', () => {
  const real =
    jest.requireActual<typeof import('./unpdf-real')>('./unpdf-real');

  return real.delegarParaUnpdfReal();
});

import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { OraculoConfig } from '../config/config.service';
import { IndexacaoService } from '../corpus/indexacao.service';
import { SecurityService } from '../security/security.service';
import {
  ArquivoEnviado,
  ConhecimentoService,
  MAXIMO_DE_ARQUIVOS_POR_LOTE,
  TAMANHO_MAXIMO_BYTES,
} from './conhecimento.service';
import { pdfComTexto, pdfCorrompido, pdfEscaneado } from './pdf-fixture';

const DIRETORIO = '/corpus/notas';
const NULO = String.fromCharCode(0);

const mkdirFalso = mkdir as jest.Mock;
const rmFalso = rm as jest.Mock;
const statFalso = stat as jest.Mock;
const writeFileFalso = writeFile as jest.Mock;

interface Montagem {
  servico: ConhecimentoService;
  indexacao: { indexarArquivo: jest.Mock; removerArquivo: jest.Mock };
  seguranca: { registrar: jest.Mock };
}

function montar(): Montagem {
  const config = {
    corpus: { notas: DIRETORIO },
  } as unknown as OraculoConfig;

  const indexacao = {
    indexarArquivo: jest
      .fn()
      .mockResolvedValue({ documentoId: 'doc-1', status: 'novo', trechos: 3 }),
    removerArquivo: jest.fn().mockResolvedValue(true),
  };

  const seguranca = { registrar: jest.fn().mockResolvedValue(null) };

  return {
    servico: new ConhecimentoService(
      config,
      indexacao as unknown as IndexacaoService,
      seguranca as unknown as SecurityService,
    ),
    indexacao,
    seguranca,
  };
}

function naoExisteNenhuma(): void {
  statFalso.mockRejectedValue(new Error('ENOENT'));
}

function arquivo(parcial: Partial<ArquivoEnviado>): ArquivoEnviado {
  return {
    originalname: 'nota.md',
    buffer: Buffer.from('# Nota\n\ncorpo', 'utf-8'),
    mimetype: 'text/markdown',
    ...parcial,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mkdirFalso.mockResolvedValue(undefined);
  rmFalso.mockResolvedValue(undefined);
  writeFileFalso.mockResolvedValue(undefined);
  naoExisteNenhuma();
});

describe('ConhecimentoService.criarNota', () => {
  it('deriva o slug do título, sem acento e sem espaço', async () => {
    const { servico } = montar();

    const nota = await servico.criarNota({
      titulo: 'Análise do Depósito Antecipado',
      conteudo: 'texto da nota',
    });

    expect(nota.slug).toBe('analise-do-deposito-antecipado');
    expect(nota.caminho).toBe(`${DIRETORIO}/analise-do-deposito-antecipado.md`);
    expect(writeFileFalso).toHaveBeenCalledWith(
      `${DIRETORIO}/analise-do-deposito-antecipado.md`,
      expect.stringContaining('# Análise do Depósito Antecipado'),
      'utf-8',
    );
  });

  it('resolve colisão de slug com sufixo numérico', async () => {
    const { servico } = montar();

    statFalso.mockImplementation((caminho: string) =>
      caminho === `${DIRETORIO}/reuniao.md` ||
      caminho === `${DIRETORIO}/reuniao-2.md`
        ? Promise.resolve({})
        : Promise.reject(new Error('ENOENT')),
    );

    const nota = await servico.criarNota({
      titulo: 'Reunião',
      conteudo: 'texto',
    });

    expect(nota.slug).toBe('reuniao-3');
    expect(nota.caminho).toBe(`${DIRETORIO}/reuniao-3.md`);
  });

  it('grava o arquivo em disco ANTES de indexar', async () => {
    const { servico, indexacao } = montar();

    await servico.criarNota({ titulo: 'Ordem', conteudo: 'texto' });

    expect(writeFileFalso.mock.invocationCallOrder[0]).toBeLessThan(
      indexacao.indexarArquivo.mock.invocationCallOrder[0],
    );
    expect(indexacao.indexarArquivo).toHaveBeenCalledWith(
      `${DIRETORIO}/ordem.md`,
    );
  });

  it('devolve o id e a contagem de trechos vindos do IndexacaoService', async () => {
    const { servico } = montar();

    const nota = await servico.criarNota({
      titulo: 'Indexada',
      conteudo: 'texto',
    });

    expect(nota).toEqual({
      id: 'doc-1',
      slug: 'indexada',
      caminho: `${DIRETORIO}/indexada.md`,
      trechosIndexados: 3,
    });
  });

  it('mantém a nota em disco quando a indexação falha', async () => {
    const { servico, indexacao } = montar();

    indexacao.indexarArquivo.mockRejectedValue(new Error('pgvector fora'));

    const nota = await servico.criarNota({
      titulo: 'Resiliente',
      conteudo: 'texto',
    });

    expect(writeFileFalso).toHaveBeenCalled();
    expect(nota.trechosIndexados).toBe(0);
    expect(nota.id).toBeNull();
  });

  it('registra a escrita na auditoria', async () => {
    const { servico, seguranca } = montar();

    await servico.criarNota(
      { titulo: 'Auditada', conteudo: 'texto' },
      'usuario-7',
    );

    expect(seguranca.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        usuarioId: 'usuario-7',
        tom: 'configuracao',
        ferramentas: [
          expect.objectContaining({ nome: 'conhecimento.nota.criar' }),
        ],
      }),
    );
  });

  it('recusa título ou conteúdo vazio', async () => {
    const { servico } = montar();

    await expect(
      servico.criarNota({ titulo: '   ', conteudo: 'texto' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      servico.criarNota({ titulo: 'Título', conteudo: '  \n ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(writeFileFalso).not.toHaveBeenCalled();
  });

  it('recusa conteúdo acima de 2 MB', async () => {
    const { servico } = montar();

    await expect(
      servico.criarNota({
        titulo: 'Gigante',
        conteudo: 'a'.repeat(TAMANHO_MAXIMO_BYTES + 1),
      }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(writeFileFalso).not.toHaveBeenCalled();
  });
});

describe('ConhecimentoService.enviarArquivo', () => {
  it('aceita .md e grava com o slug do nome do arquivo', async () => {
    const { servico } = montar();

    const nota = await servico.enviarArquivo(
      arquivo({ originalname: 'Notas de Reunião.md' }),
    );

    expect(nota.slug).toBe('notas-de-reuniao');
    expect(writeFileFalso).toHaveBeenCalledWith(
      `${DIRETORIO}/notas-de-reuniao.md`,
      '# Nota\n\ncorpo',
      'utf-8',
    );
  });

  it('aceita .txt e normaliza o arquivo gravado para .md', async () => {
    const { servico } = montar();

    const nota = await servico.enviarArquivo(
      arquivo({
        originalname: 'anotacoes.txt',
        mimetype: 'text/plain',
        buffer: Buffer.from('texto simples', 'utf-8'),
      }),
    );

    expect(nota.caminho).toBe(`${DIRETORIO}/anotacoes.md`);
  });

  it('recusa binário disfarçado de .md (byte nulo no buffer)', async () => {
    const { servico, indexacao } = montar();

    const binario = Buffer.from(`PK${NULO}${NULO}conteudo`, 'latin1');

    await expect(
      servico.enviarArquivo(
        arquivo({ originalname: 'disfarce.md', buffer: binario }),
      ),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);

    expect(writeFileFalso).not.toHaveBeenCalled();
    expect(indexacao.indexarArquivo).not.toHaveBeenCalled();
  });

  it('recusa mesmo quando o mimetype enviado mente que é texto', async () => {
    const { servico } = montar();

    await expect(
      servico.enviarArquivo(
        arquivo({
          originalname: 'mentiroso.md',
          mimetype: 'text/markdown',
          buffer: Buffer.from(`ok${NULO}`, 'latin1'),
        }),
      ),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });

  it('recusa conteúdo que não é UTF-8 válido', async () => {
    const { servico } = montar();

    await expect(
      servico.enviarArquivo(
        arquivo({
          originalname: 'latin1.txt',
          buffer: Buffer.from([0xc3, 0x28, 0xa0, 0xa1]),
        }),
      ),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    expect(writeFileFalso).not.toHaveBeenCalled();
  });

  it('recusa arquivo acima de 2 MB', async () => {
    const { servico } = montar();

    await expect(
      servico.enviarArquivo(
        arquivo({
          originalname: 'grande.md',
          buffer: Buffer.alloc(TAMANHO_MAXIMO_BYTES + 1, 0x61),
        }),
      ),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(writeFileFalso).not.toHaveBeenCalled();
  });

  it('recusa arquivo cujo size declarado passa de 2 MB', async () => {
    const { servico } = montar();

    await expect(
      servico.enviarArquivo(
        arquivo({ originalname: 'grande.md', size: TAMANHO_MAXIMO_BYTES + 1 }),
      ),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('recusa .pdf que não abre, com o erro do leitor tratado', async () => {
    const { servico } = montar();

    const erro = await servico
      .enviarArquivo(
        arquivo({
          originalname: 'contrato.pdf',
          mimetype: 'application/pdf',
          buffer: Buffer.from('%PDF-1.7\n', 'latin1'),
        }),
      )
      .catch((capturado: unknown) => capturado);

    expect(erro).toBeInstanceOf(UnsupportedMediaTypeException);
    expect((erro as Error).message).toContain('PDF');
    expect((erro as Error).message).toContain('corrompido');
    expect(writeFileFalso).not.toHaveBeenCalled();
  });

  it('trata PDF disfarçado de .md pela assinatura do conteúdo, não pela extensão', async () => {
    const { servico } = montar();

    const erro = await servico
      .enviarArquivo(
        arquivo({
          originalname: 'disfarce.md',
          mimetype: 'text/markdown',
          buffer: Buffer.from(`%PDF-1.4${NULO}objs`, 'latin1'),
        }),
      )
      .catch((capturado: unknown) => capturado);

    expect(erro).toBeInstanceOf(UnsupportedMediaTypeException);
    expect((erro as Error).message).toContain('PDF');
  });

  it('aceita PDF com texto: grava o texto extraído como .md e indexa', async () => {
    const { servico, indexacao } = montar();

    const nota = await servico.enviarArquivo(
      arquivo({
        originalname: 'Guia do Oraculo.pdf',
        mimetype: 'application/pdf',
        buffer: pdfComTexto('Deposito Antecipado'),
      }),
    );

    expect(nota.slug).toBe('guia-do-oraculo');
    expect(nota.caminho).toBe(`${DIRETORIO}/guia-do-oraculo.md`);
    expect(nota.trechosIndexados).toBe(3);
    expect(writeFileFalso).toHaveBeenCalledWith(
      `${DIRETORIO}/guia-do-oraculo.md`,
      expect.stringContaining('Deposito Antecipado'),
      'utf-8',
    );
    expect(writeFileFalso).toHaveBeenCalledWith(
      `${DIRETORIO}/guia-do-oraculo.md`,
      expect.stringContaining('# Guia do Oraculo'),
      'utf-8',
    );
    expect(indexacao.indexarArquivo).toHaveBeenCalledWith(
      `${DIRETORIO}/guia-do-oraculo.md`,
    );
  });

  it('recusa PDF digitalizado, que não tem camada de texto, sem gravar nada', async () => {
    const { servico, indexacao } = montar();

    const erro = await servico
      .enviarArquivo(
        arquivo({
          originalname: 'escaneado.pdf',
          mimetype: 'application/pdf',
          buffer: pdfEscaneado(),
        }),
      )
      .catch((capturado: unknown) => capturado);

    expect(erro).toBeInstanceOf(UnsupportedMediaTypeException);
    expect((erro as Error).message).toContain('imagem');
    expect((erro as Error).message).toContain('OCR');
    expect(writeFileFalso).not.toHaveBeenCalled();
    expect(indexacao.indexarArquivo).not.toHaveBeenCalled();
  });

  it('recusa extensão fora de .md, .txt e .pdf', async () => {
    const { servico } = montar();

    await expect(
      servico.enviarArquivo(arquivo({ originalname: 'planilha.csv' })),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    await expect(
      servico.enviarArquivo(arquivo({ originalname: 'sem-extensao' })),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });

  it('recusa arquivo ausente ou vazio', async () => {
    const { servico } = montar();

    await expect(servico.enviarArquivo(undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      servico.enviarArquivo(
        arquivo({ originalname: 'vazio.md', buffer: Buffer.alloc(0) }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('neutraliza traversal vindo no nome do arquivo', async () => {
    const { servico } = montar();

    const nota = await servico.enviarArquivo(
      arquivo({ originalname: '../../etc/passwd.md' }),
    );

    expect(nota.slug).toBe('passwd');
    expect(nota.caminho).toBe(`${DIRETORIO}/passwd.md`);
  });
});

describe('ConhecimentoService.enviarArquivos', () => {
  it('um arquivo só continua funcionando', async () => {
    const { servico } = montar();

    const lote = await servico.enviarArquivos([
      arquivo({ originalname: 'sozinho.md' }),
    ]);

    expect(lote).toEqual({
      total: 1,
      aceitos: 1,
      recusados: 0,
      itens: [
        {
          arquivo: 'sozinho.md',
          aceito: true,
          motivo: null,
          id: 'doc-1',
          slug: 'sozinho',
          caminho: `${DIRETORIO}/sozinho.md`,
          trechosIndexados: 3,
        },
      ],
    });
  });

  it('um arquivo ruim não derruba o lote — devolve os dois resultados', async () => {
    const { servico } = montar();

    const lote = await servico.enviarArquivos([
      arquivo({ originalname: 'bom.md' }),
      arquivo({
        originalname: 'ruim.exe',
        buffer: Buffer.from('MZ binário', 'latin1'),
      }),
      arquivo({ originalname: 'outro-bom.txt' }),
    ]);

    expect(lote.total).toBe(3);
    expect(lote.aceitos).toBe(2);
    expect(lote.recusados).toBe(1);
    expect(lote.itens.map((item) => item.arquivo)).toEqual([
      'bom.md',
      'ruim.exe',
      'outro-bom.txt',
    ]);
    expect(lote.itens[1].aceito).toBe(false);
    expect(lote.itens[1].motivo).toContain('não é aceito');
    expect(lote.itens[1].caminho).toBeNull();
    expect(lote.itens[0].caminho).toBe(`${DIRETORIO}/bom.md`);
    expect(lote.itens[2].caminho).toBe(`${DIRETORIO}/outro-bom.md`);
  });

  it('mistura PDF indexado e PDF digitalizado recusado no mesmo lote', async () => {
    const { servico } = montar();

    const lote = await servico.enviarArquivos([
      arquivo({
        originalname: 'com-texto.pdf',
        mimetype: 'application/pdf',
        buffer: pdfComTexto('Relatorio de Producao'),
      }),
      arquivo({
        originalname: 'escaneado.pdf',
        mimetype: 'application/pdf',
        buffer: pdfEscaneado(),
      }),
      arquivo({
        originalname: 'quebrado.pdf',
        mimetype: 'application/pdf',
        buffer: pdfCorrompido(),
      }),
    ]);

    expect(lote.aceitos).toBe(1);
    expect(lote.recusados).toBe(2);
    expect(lote.itens[0].caminho).toBe(`${DIRETORIO}/com-texto.md`);
    expect(lote.itens[1].motivo).toContain('OCR');
    expect(lote.itens[2].motivo).toContain('corrompido');
    expect(writeFileFalso).toHaveBeenCalledTimes(1);
  });

  it('aceita o lote no teto de 20 arquivos e recusa o de 21', async () => {
    const { servico } = montar();

    const cheio = Array.from(
      { length: MAXIMO_DE_ARQUIVOS_POR_LOTE },
      (_valor, indice) => arquivo({ originalname: `nota-${indice}.md` }),
    );

    const lote = await servico.enviarArquivos(cheio);

    expect(lote.total).toBe(MAXIMO_DE_ARQUIVOS_POR_LOTE);
    expect(lote.aceitos).toBe(MAXIMO_DE_ARQUIVOS_POR_LOTE);

    await expect(
      servico.enviarArquivos([...cheio, arquivo({ originalname: 'extra.md' })]),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('recusa lote vazio ou ausente antes de tocar em disco', async () => {
    const { servico } = montar();

    await expect(servico.enviarArquivos([])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(servico.enviarArquivos(undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(writeFileFalso).not.toHaveBeenCalled();
  });

  it('registra cada arquivo aceito na auditoria, um registro por arquivo', async () => {
    const { servico, seguranca } = montar();

    await servico.enviarArquivos(
      [
        arquivo({ originalname: 'um.md' }),
        arquivo({ originalname: 'dois.md' }),
        arquivo({ originalname: 'tres.csv' }),
      ],
      'usuario-7',
    );

    expect(seguranca.registrar).toHaveBeenCalledTimes(2);
  });
});

describe('ConhecimentoService.editarNota', () => {
  it('regrava a nota e só então reindexa o mesmo caminho', async () => {
    const { servico, indexacao } = montar();

    statFalso.mockResolvedValue({});

    const nota = await servico.editarNota('reuniao', '# Reunião\n\nnovo corpo');

    expect(writeFileFalso).toHaveBeenCalledWith(
      `${DIRETORIO}/reuniao.md`,
      '# Reunião\n\nnovo corpo',
      'utf-8',
    );
    expect(writeFileFalso.mock.invocationCallOrder[0]).toBeLessThan(
      indexacao.indexarArquivo.mock.invocationCallOrder[0],
    );
    expect(indexacao.indexarArquivo).toHaveBeenCalledWith(
      `${DIRETORIO}/reuniao.md`,
    );
    expect(nota).toEqual({
      id: 'doc-1',
      slug: 'reuniao',
      caminho: `${DIRETORIO}/reuniao.md`,
      trechosIndexados: 3,
    });
  });

  it('grava o conteúdo exatamente como veio, sem inventar cabeçalho', async () => {
    const { servico } = montar();

    statFalso.mockResolvedValue({});

    await servico.editarNota('reuniao', 'só um parágrafo solto');

    expect(writeFileFalso).toHaveBeenCalledWith(
      `${DIRETORIO}/reuniao.md`,
      'só um parágrafo solto',
      'utf-8',
    );
  });

  it('registra a edição na auditoria', async () => {
    const { servico, seguranca } = montar();

    statFalso.mockResolvedValue({});

    await servico.editarNota('reuniao', 'novo corpo', 'usuario-7');

    expect(seguranca.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        usuarioId: 'usuario-7',
        tom: 'configuracao',
        ferramentas: [
          expect.objectContaining({ nome: 'conhecimento.nota.editar' }),
        ],
      }),
    );
  });

  it('devolve 404 quando a nota não existe em disco', async () => {
    const { servico, indexacao } = montar();

    await expect(
      servico.editarNota('inexistente', 'corpo'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(writeFileFalso).not.toHaveBeenCalled();
    expect(indexacao.indexarArquivo).not.toHaveBeenCalled();
  });

  it('recusa travessia de caminho antes de tocar em disco', async () => {
    const { servico, indexacao } = montar();

    for (const slug of [
      '../../etc/passwd',
      'a/b',
      '..',
      '/etc/passwd',
      'nota.md',
      'NOTA',
    ]) {
      await expect(servico.editarNota(slug, 'corpo')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }

    expect(statFalso).not.toHaveBeenCalled();
    expect(writeFileFalso).not.toHaveBeenCalled();
    expect(indexacao.indexarArquivo).not.toHaveBeenCalled();
  });

  it('recusa conteúdo vazio ou só de espaço', async () => {
    const { servico } = montar();

    statFalso.mockResolvedValue({});

    await expect(servico.editarNota('reuniao', '')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(servico.editarNota('reuniao', ' \n ')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(writeFileFalso).not.toHaveBeenCalled();
  });

  it('recusa conteúdo acima de 2 MB', async () => {
    const { servico } = montar();

    statFalso.mockResolvedValue({});

    await expect(
      servico.editarNota('reuniao', 'a'.repeat(TAMANHO_MAXIMO_BYTES + 1)),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(writeFileFalso).not.toHaveBeenCalled();
  });

  it('mantém a nota em disco quando a reindexação falha', async () => {
    const { servico, indexacao } = montar();

    statFalso.mockResolvedValue({});
    indexacao.indexarArquivo.mockRejectedValue(new Error('pgvector fora'));

    const nota = await servico.editarNota('reuniao', 'novo corpo');

    expect(writeFileFalso).toHaveBeenCalled();
    expect(nota.id).toBeNull();
    expect(nota.trechosIndexados).toBe(0);
  });
});

describe('ConhecimentoService.removerNota', () => {
  it('apaga o arquivo e os trechos do índice', async () => {
    const { servico, indexacao, seguranca } = montar();

    statFalso.mockResolvedValue({});

    await servico.removerNota('reuniao', 'usuario-7');

    expect(indexacao.removerArquivo).toHaveBeenCalledWith(
      `${DIRETORIO}/reuniao.md`,
    );
    expect(rmFalso).toHaveBeenCalledWith(`${DIRETORIO}/reuniao.md`, {
      force: true,
    });
    expect(seguranca.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        usuarioId: 'usuario-7',
        ferramentas: [
          expect.objectContaining({ nome: 'conhecimento.nota.remover' }),
        ],
      }),
    );
  });

  it('recusa path traversal antes de tocar em disco ou índice', async () => {
    const { servico, indexacao } = montar();

    const slugs = [
      '..',
      '../etc/passwd',
      '../../../../etc/shadow',
      'sub/nota',
      'nota/../outra',
      '/etc/passwd',
      'nota.md',
    ];

    for (const slug of slugs) {
      await expect(servico.removerNota(slug)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }

    expect(indexacao.removerArquivo).not.toHaveBeenCalled();
    expect(rmFalso).not.toHaveBeenCalled();
    expect(statFalso).not.toHaveBeenCalled();
  });

  it('devolve 404 quando a nota não existe nem em disco nem no índice', async () => {
    const { servico, indexacao } = montar();

    indexacao.removerArquivo.mockResolvedValue(false);

    await expect(servico.removerNota('inexistente')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(rmFalso).not.toHaveBeenCalled();
  });

  it('ainda limpa o índice quando o arquivo já sumiu do disco', async () => {
    const { servico, indexacao } = montar();

    await servico.removerNota('orfa');

    expect(indexacao.removerArquivo).toHaveBeenCalledWith(
      `${DIRETORIO}/orfa.md`,
    );
    expect(rmFalso).not.toHaveBeenCalled();
  });
});

describe('ConhecimentoService e o diretório de notas', () => {
  it('cria o diretório antes de gravar', async () => {
    const { servico } = montar();

    await servico.criarNota({ titulo: 'Primeira', conteudo: 'texto' });

    expect(mkdirFalso).toHaveBeenCalledWith(DIRETORIO, { recursive: true });
    expect(mkdirFalso.mock.invocationCallOrder[0]).toBeLessThan(
      writeFileFalso.mock.invocationCallOrder[0],
    );
  });

  it('recusa operar sem DIRETORIO_NOTAS configurado', async () => {
    const servico = new ConhecimentoService(
      { corpus: { notas: '' } } as unknown as OraculoConfig,
      {
        indexarArquivo: jest.fn(),
        removerArquivo: jest.fn(),
      } as unknown as IndexacaoService,
      { registrar: jest.fn() } as unknown as SecurityService,
    );

    await expect(
      servico.criarNota({ titulo: 'Nota', conteudo: 'texto' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
