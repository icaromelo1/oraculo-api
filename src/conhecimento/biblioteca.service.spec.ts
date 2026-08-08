import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Repository } from 'typeorm';
import { resolverRaizes } from '../capabilities/codigo/seguranca';
import { OraculoConfig } from '../config/config.service';
import { ConfiguracaoService } from '../config/configuracao.service';
import { Documento, Trecho } from '../database/entities';
import { BibliotecaService, TETO_DE_LEITURA_BYTES } from './biblioteca.service';
import { validarListarDocumentosDto } from './dto/listar-documentos.dto';

const EXIBICAO = '/home/ubuntu/corpus-exibido';
const UUID_GUIA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UUID_NOTA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UUID_SUMIDO = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const UUID_FORA = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const UUID_GRANDE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

let base: string;
let corpus: string;
let notas: string;
let fora: string;

interface ConsultaFalsa {
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  addOrderBy: jest.Mock;
  skip: jest.Mock;
  take: jest.Mock;
  getManyAndCount: jest.Mock;
}

interface Montagem {
  servico: BibliotecaService;
  consulta: ConsultaFalsa;
  documentos: { createQueryBuilder: jest.Mock; findOne: jest.Mock };
  consultaCrua: jest.Mock;
}

function documento(parcial: Partial<Documento> = {}): Documento {
  return {
    id: UUID_GUIA,
    caminho: join(corpus, 'guia.md'),
    fonte: 'doc',
    autoridade: 2,
    titulo: 'Guia',
    hash: 'hash-do-guia',
    atualizadoEm: new Date('2026-08-01T10:00:00.000Z'),
    meta: null,
    moduloId: null,
    descricao: null,
    ...parcial,
  };
}

function montarConsulta(linhas: Documento[], total?: number): ConsultaFalsa {
  const consulta = {} as ConsultaFalsa;

  for (const metodo of [
    'andWhere',
    'orderBy',
    'addOrderBy',
    'skip',
    'take',
  ] as const) {
    consulta[metodo] = jest.fn(() => consulta);
  }

  consulta.getManyAndCount = jest
    .fn()
    .mockResolvedValue([linhas, total ?? linhas.length]);

  return consulta;
}

function montar(
  linhas: Documento[] = [],
  total?: number,
  contagemDeTrechos: { documentoId: string; total: number }[] = [],
): Montagem {
  const consulta = montarConsulta(linhas, total);

  const documentos = {
    createQueryBuilder: jest.fn(() => consulta),
    findOne: jest.fn().mockResolvedValue(linhas[0] ?? null),
  };

  const consultaCrua = jest.fn().mockResolvedValue(contagemDeTrechos);

  const config = {
    corpus: {
      fontes: [corpus],
      negados: [],
      exibicao: [`${corpus}=${EXIBICAO}`],
      notas,
    },
  } as unknown as OraculoConfig;

  const configuracao = {
    raizesDeLeitura: () => resolverRaizes([corpus]),
  } as unknown as ConfiguracaoService;

  const servico = new BibliotecaService(
    config,
    configuracao,
    documentos as unknown as Repository<Documento>,
    { manager: { query: consultaCrua } } as unknown as Repository<Trecho>,
  );

  return { servico, consulta, documentos, consultaCrua };
}

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'oraculo-biblioteca-'));
  corpus = join(base, 'corpus');
  notas = join(base, 'notas');
  fora = join(base, 'fora');

  await mkdir(corpus, { recursive: true });
  await mkdir(notas, { recursive: true });
  await mkdir(fora, { recursive: true });

  await writeFile(join(corpus, 'guia.md'), '# Guia\n\ncorpo do guia', 'utf-8');
  await writeFile(
    join(corpus, 'grande.md'),
    'a'.repeat(TETO_DE_LEITURA_BYTES + 1000),
    'utf-8',
  );
  await writeFile(join(notas, 'minha-nota.md'), '# Minha nota\n\ncorpo');
  await writeFile(join(fora, 'segredo.md'), 'segredo que não sai daqui');
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('BibliotecaService.listar', () => {
  it('devolve total, página e tamanho pedidos, aplicando skip e take', async () => {
    const { servico, consulta } = montar([documento()], 120);

    const lista = await servico.listar(
      validarListarDocumentosDto({ pagina: '3', porPagina: '30' }),
    );

    expect(consulta.skip).toHaveBeenCalledWith(60);
    expect(consulta.take).toHaveBeenCalledWith(30);
    expect(lista.total).toBe(120);
    expect(lista.pagina).toBe(3);
    expect(lista.porPagina).toBe(30);
    expect(lista.documentos).toHaveLength(1);
  });

  it('respeita o teto de 100 por página mesmo com pedido maior', async () => {
    const { servico, consulta } = montar([]);

    const lista = await servico.listar(
      validarListarDocumentosDto({ porPagina: '900' }),
    );

    expect(consulta.take).toHaveBeenCalledWith(100);
    expect(lista.porPagina).toBe(100);
  });

  it('filtra por busca em título e caminho, sem distinguir caixa', async () => {
    const { servico, consulta } = montar([]);

    await servico.listar(validarListarDocumentosDto({ busca: 'deposito' }));

    expect(consulta.andWhere).toHaveBeenCalledWith(
      '(documento.titulo ILIKE :busca OR documento.caminho ILIKE :busca)',
      { busca: '%deposito%' },
    );
  });

  it('filtra por fonte e por autoridade', async () => {
    const { servico, consulta } = montar([]);

    await servico.listar(
      validarListarDocumentosDto({ fonte: 'nota', autoridade: '1' }),
    );

    expect(consulta.andWhere).toHaveBeenCalledWith('documento.fonte = :fonte', {
      fonte: 'nota',
    });
    expect(consulta.andWhere).toHaveBeenCalledWith(
      'documento.autoridade = :autoridade',
      { autoridade: 1 },
    );
  });

  it('não filtra nada quando nenhum filtro é informado', async () => {
    const { servico, consulta } = montar([]);

    await servico.listar(validarListarDocumentosDto({}));

    expect(consulta.andWhere).not.toHaveBeenCalled();
  });

  it('marca como editável só o que está dentro do diretório de notas', async () => {
    const { servico } = montar([
      documento({ id: UUID_NOTA, caminho: join(notas, 'minha-nota.md') }),
      documento(),
      documento({ id: UUID_FORA, caminho: `${notas}-vizinho/farsa.md` }),
    ]);

    const lista = await servico.listar(validarListarDocumentosDto({}));

    expect(lista.documentos.map((item) => item.editavel)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('traduz o caminho para exibição e mantém o real ao lado', async () => {
    const { servico } = montar([documento()]);

    const [primeiro] = (await servico.listar(validarListarDocumentosDto({})))
      .documentos;

    expect(primeiro.caminho).toBe(`${EXIBICAO}/guia.md`);
    expect(primeiro.caminhoReal).toBe(join(corpus, 'guia.md'));
  });

  it('ordena por data por padrão e por nome quando pedido', async () => {
    const padrao = montar([]);

    await padrao.servico.listar(validarListarDocumentosDto({}));

    expect(padrao.consulta.orderBy).toHaveBeenCalledWith(
      'documento.atualizadoEm',
      'DESC',
    );

    const porNome = montar([]);

    await porNome.servico.listar(
      validarListarDocumentosDto({ ordenar: 'nome' }),
    );

    expect(porNome.consulta.orderBy).toHaveBeenCalledWith(
      'LOWER(documento.titulo)',
      'ASC',
    );
  });

  it('recusa ordenação desconhecida', () => {
    expect(() => validarListarDocumentosDto({ ordenar: 'tamanho' })).toThrow(
      BadRequestException,
    );
  });

  it('filtra por módulo e pelos que estão sem módulo', async () => {
    const { servico, consulta } = montar([]);

    await servico.listar(validarListarDocumentosDto({ modulo: UUID_NOTA }));

    expect(consulta.andWhere).toHaveBeenCalledWith(
      'documento.moduloId = :modulo',
      { modulo: UUID_NOTA },
    );

    const semModulo = montar([]);

    await semModulo.servico.listar(
      validarListarDocumentosDto({ modulo: 'nenhum' }),
    );

    expect(semModulo.consulta.andWhere).toHaveBeenCalledWith(
      'documento.moduloId IS NULL',
    );
  });

  it('recusa filtro de módulo que não é id nem "nenhum"', () => {
    expect(() => validarListarDocumentosDto({ modulo: 'infra' })).toThrow(
      BadRequestException,
    );
  });

  it('devolve módulo e descrição para a tela reler o que salvou', async () => {
    const { servico } = montar([
      documento({ moduloId: UUID_NOTA, descricao: 'passo a passo do backup' }),
    ]);

    const [primeiro] = (await servico.listar(validarListarDocumentosDto({})))
      .documentos;

    expect(primeiro.moduloId).toBe(UUID_NOTA);
    expect(primeiro.descricao).toBe('passo a passo do backup');
  });

  it('conta os trechos numa consulta agregada só, não uma por documento', async () => {
    const { servico, consultaCrua } = montar(
      [
        documento(),
        documento({ id: UUID_NOTA, caminho: join(notas, 'minha-nota.md') }),
      ],
      2,
      [
        { documentoId: UUID_GUIA, total: 3 },
        { documentoId: UUID_NOTA, total: 7 },
      ],
    );

    const lista = await servico.listar(validarListarDocumentosDto({}));

    expect(consultaCrua).toHaveBeenCalledTimes(1);
    expect(consultaCrua).toHaveBeenCalledWith(
      expect.stringContaining('GROUP BY documento_id'),
      [[UUID_GUIA, UUID_NOTA]],
    );
    expect(lista.documentos.map((item) => item.trechos)).toEqual([3, 7]);
  });

  it('não consulta trechos quando a página vem vazia', async () => {
    const { servico, consultaCrua } = montar([]);

    await servico.listar(validarListarDocumentosDto({}));

    expect(consultaCrua).not.toHaveBeenCalled();
  });

  it('devolve o tamanho em disco e zero para o que sumiu', async () => {
    const { servico } = montar([
      documento(),
      documento({ id: UUID_SUMIDO, caminho: join(corpus, 'apagado.md') }),
    ]);

    const lista = await servico.listar(validarListarDocumentosDto({}));

    expect(lista.documentos[0].bytes).toBeGreaterThan(0);
    expect(lista.documentos[1].bytes).toBe(0);
  });
});

describe('BibliotecaService.abrir', () => {
  it('devolve o conteúdo inteiro do arquivo em disco', async () => {
    const { servico } = montar([documento()]);

    const aberto = await servico.abrir(UUID_GUIA);

    expect(aberto.conteudo).toBe('# Guia\n\ncorpo do guia');
    expect(aberto.truncado).toBe(false);
    expect(aberto.aviso).toBeNull();
    expect(aberto.caminho).toBe(`${EXIBICAO}/guia.md`);
    expect(aberto.caminhoReal).toBe(join(corpus, 'guia.md'));
    expect(aberto.editavel).toBe(false);
    expect(aberto.bytes).toBe(Buffer.byteLength('# Guia\n\ncorpo do guia'));
  });

  it('marca a nota como editável', async () => {
    const { servico } = montar([
      documento({
        id: UUID_NOTA,
        caminho: join(notas, 'minha-nota.md'),
        fonte: 'nota',
        autoridade: 1,
      }),
    ]);

    const aberto = await servico.abrir(UUID_NOTA);

    expect(aberto.editavel).toBe(true);
    expect(aberto.conteudo).toBe('# Minha nota\n\ncorpo');
  });

  it('devolve 404 para documento que não está indexado', async () => {
    const { servico, documentos } = montar([]);

    documentos.findOne.mockResolvedValue(null);

    await expect(servico.abrir(UUID_GUIA)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('devolve 404 para id que nem é uuid, sem consultar o banco', async () => {
    const { servico, documentos } = montar([]);

    await expect(
      servico.abrir("'; DROP TABLE documento; --"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(documentos.findOne).not.toHaveBeenCalled();
  });

  it('devolve conteudo nulo e aviso quando o arquivo sumiu do disco', async () => {
    const { servico } = montar([
      documento({ id: UUID_SUMIDO, caminho: join(corpus, 'apagado.md') }),
    ]);

    const aberto = await servico.abrir(UUID_SUMIDO);

    expect(aberto.conteudo).toBeNull();
    expect(aberto.bytes).toBe(0);
    expect(aberto.aviso).toContain('não está legível em disco');
    expect(aberto.caminho).toBe(`${EXIBICAO}/apagado.md`);
  });

  it('recusa ler documento cujo caminho gravado está fora das raízes permitidas', async () => {
    const { servico } = montar([
      documento({ id: UUID_FORA, caminho: join(fora, 'segredo.md') }),
    ]);

    await expect(servico.abrir(UUID_FORA)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('recusa caminho com travessia gravado no banco', async () => {
    const { servico } = montar([
      documento({ id: UUID_FORA, caminho: `${corpus}/../fora/segredo.md` }),
    ]);

    await expect(servico.abrir(UUID_FORA)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('trunca em 1 MB e avisa que só o começo foi carregado', async () => {
    const { servico } = montar([
      documento({ id: UUID_GRANDE, caminho: join(corpus, 'grande.md') }),
    ]);

    const aberto = await servico.abrir(UUID_GRANDE);

    expect(aberto.truncado).toBe(true);
    expect(aberto.conteudo).toHaveLength(TETO_DE_LEITURA_BYTES);
    expect(aberto.bytes).toBe(TETO_DE_LEITURA_BYTES + 1000);
    expect(aberto.aviso).toContain('só o começo foi carregado');
  });
});
