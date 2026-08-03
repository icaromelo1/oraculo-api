import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource, Repository } from 'typeorm';
import { Documento, entidades, Trecho } from '../../database/entities';
import type { OraculoConfig } from '../../config/config.service';
import { EmbeddingService } from '../../corpus/embedding.service';
import { CONSULTA_TESTE } from './fixture.conteudo';
import { BuscarConhecimentoCapacidade } from './buscar-conhecimento.capacidade';
import { LerDocumentoCapacidade } from './ler-documento.capacidade';

jest.setTimeout(60_000);

interface FixtureIndexada {
  caminhoMemoria: string;
  caminhoConfig: string;
  caminhoDoc: string;
  resumo: { documentosNovos: number; trechosGerados: number };
  vetorConsulta: number[];
}

function configDeTeste(
  fontes: string[],
  modo: 'hibrido' | 'lexical' | 'vetorial' = 'hibrido',
): OraculoConfig {
  return {
    corpus: { fontes, negados: [] },
    recuperacao: {
      modo,
      modeloEmbedding: 'Xenova/multilingual-e5-small',
      dimensoes: 384,
    },
  } as unknown as OraculoConfig;
}

describe('busca de conhecimento — integração real (Postgres + pgvector)', () => {
  let raiz: string;
  let fixture: FixtureIndexada;
  let dataSource: DataSource;
  let documentoRepo: Repository<Documento>;
  let trechoRepo: Repository<Trecho>;
  let embedding: EmbeddingService;
  let embutirEspiao: jest.SpyInstance;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: entidades,
    });
    await dataSource.initialize();

    documentoRepo = dataSource.getRepository(Documento);
    trechoRepo = dataSource.getRepository(Trecho);

    await trechoRepo.query(
      `DELETE FROM trecho WHERE documento_id IN (SELECT id FROM documento WHERE caminho LIKE '%oraculo-conhecimento-%')`,
    );
    await documentoRepo.query(
      `DELETE FROM documento WHERE caminho LIKE '%oraculo-conhecimento-%'`,
    );

    raiz = await mkdtemp(join(tmpdir(), 'oraculo-conhecimento-'));
    const arquivoSaida = join(raiz, '__resultado__.json');

    execFileSync(
      'npx',
      [
        'ts-node',
        '-r',
        'tsconfig-paths/register',
        join(__dirname, 'gerar-fixture-teste.ts'),
        raiz,
        CONSULTA_TESTE,
        arquivoSaida,
      ],
      { cwd: process.cwd(), encoding: 'utf-8', maxBuffer: 1024 * 1024 * 10 },
    );

    fixture = JSON.parse(
      await readFile(arquivoSaida, 'utf-8'),
    ) as FixtureIndexada;

    expect(fixture.resumo.documentosNovos).toBe(3);
    expect(fixture.resumo.trechosGerados).toBe(3);

    embedding = new EmbeddingService(configDeTeste([raiz]));
    embutirEspiao = jest
      .spyOn(embedding, 'embutir')
      .mockImplementation((_textos, opcoes) => {
        if (opcoes?.prefixo === 'query') {
          return Promise.resolve([fixture.vetorConsulta]);
        }
        return Promise.resolve([]);
      });
  });

  beforeEach(() => {
    embutirEspiao.mockClear();
  });

  afterAll(async () => {
    await trechoRepo.query(
      `DELETE FROM trecho WHERE documento_id IN (SELECT id FROM documento WHERE caminho = ANY($1))`,
      [[fixture.caminhoMemoria, fixture.caminhoConfig, fixture.caminhoDoc]],
    );
    await documentoRepo.query(`DELETE FROM documento WHERE caminho = ANY($1)`, [
      [fixture.caminhoMemoria, fixture.caminhoConfig, fixture.caminhoDoc],
    ]);
    await dataSource.destroy();
    await rm(raiz, { recursive: true, force: true });
  });

  it('indexa os 3 documentos com a autoridade correta (memória=1, doc=2, config=3)', async () => {
    const memoria = await documentoRepo.findOne({
      where: { caminho: fixture.caminhoMemoria },
    });
    const config = await documentoRepo.findOne({
      where: { caminho: fixture.caminhoConfig },
    });
    const doc = await documentoRepo.findOne({
      where: { caminho: fixture.caminhoDoc },
    });

    expect(memoria).toMatchObject({ fonte: 'memoria', autoridade: 1 });
    expect(doc).toMatchObject({ fonte: 'doc', autoridade: 2 });
    expect(config).toMatchObject({ fonte: 'config', autoridade: 3 });
  });

  it('lexical e vetorial discordam sobre quem vence entre memória e config (posições trocadas)', async () => {
    const capacidade = new BuscarConhecimentoCapacidade(
      configDeTeste([raiz]),
      embedding,
      trechoRepo,
    );

    const lexical = await (
      capacidade as unknown as {
        buscarLexical(
          c: string,
          p: number,
        ): Promise<Array<{ caminho: string }>>;
      }
    ).buscarLexical(CONSULTA_TESTE, 30);

    const vetorial = await (
      capacidade as unknown as {
        buscarVetorial(
          c: string,
          p: number,
        ): Promise<Array<{ caminho: string }>>;
      }
    ).buscarVetorial(CONSULTA_TESTE, 30);

    expect(lexical[0].caminho).toBe(fixture.caminhoMemoria);
    expect(lexical[1].caminho).toBe(fixture.caminhoConfig);

    expect(vetorial[0].caminho).toBe(fixture.caminhoConfig);
    expect(vetorial[1].caminho).toBe(fixture.caminhoMemoria);
  });

  it('busca híbrida: em empate de RRF, a autoridade da fonte decide — memória (1) vence config (3)', async () => {
    const capacidade = new BuscarConhecimentoCapacidade(
      configDeTeste([raiz], 'hibrido'),
      embedding,
      trechoRepo,
    );

    const resultado = await capacidade.executar({ consulta: CONSULTA_TESTE });

    expect(resultado.volume).toBe(3);
    expect(resultado.retornos.map((r) => r.origem.tipo)).toEqual([
      'memoria',
      'config',
      'doc',
    ]);
    expect(resultado.retornos[0].origem.caminho).toBe(fixture.caminhoMemoria);
    expect(resultado.retornos[0].origem.meta).toMatch(/^linhas \d+-\d+$/);
  });

  it('respeita o limite pedido, cortando a lista já fundida', async () => {
    const capacidade = new BuscarConhecimentoCapacidade(
      configDeTeste([raiz], 'hibrido'),
      embedding,
      trechoRepo,
    );

    const resultado = await capacidade.executar({
      consulta: CONSULTA_TESTE,
      limite: 1,
    });

    expect(resultado.volume).toBe(1);
    expect(resultado.retornos[0].origem.tipo).toBe('memoria');
  });

  it('modo lexical não chama o embedding e não usa a lista vetorial', async () => {
    const capacidade = new BuscarConhecimentoCapacidade(
      configDeTeste([raiz], 'lexical'),
      embedding,
      trechoRepo,
    );

    const resultado = await capacidade.executar({ consulta: CONSULTA_TESTE });

    expect(embutirEspiao).not.toHaveBeenCalled();
    expect(resultado.retornos.map((r) => r.origem.tipo).sort()).toEqual([
      'config',
      'memoria',
    ]);
  });

  it('CORPUS_FONTES vazio devolve vazio com mensagem clara, nunca erro', async () => {
    const capacidade = new BuscarConhecimentoCapacidade(
      configDeTeste([]),
      embedding,
      trechoRepo,
    );

    const resultado = await capacidade.executar({ consulta: CONSULTA_TESTE });

    expect(resultado.retornos).toEqual([]);
    expect(resultado.volume).toBe(0);
    expect(resultado.metrica).toContain('CORPUS_FONTES');
  });

  it('ler_documento devolve o conteúdo inteiro do documento indexado', async () => {
    const lerDocumento = new LerDocumentoCapacidade(documentoRepo, trechoRepo);

    const resultado = await lerDocumento.executar({
      caminho: fixture.caminhoMemoria,
    });

    expect(resultado.volume).toBe(1);
    expect(resultado.retornos[0].conteudo).toContain(
      'Assim que a chave expira',
    );
    expect(resultado.retornos[0].origem.tipo).toBe('memoria');
  });

  it('ler_documento recusa caminho que não está indexado, sem tocar o disco', async () => {
    const lerDocumento = new LerDocumentoCapacidade(documentoRepo, trechoRepo);

    const resultado = await lerDocumento.executar({
      caminho: join(raiz, 'nao-existe.md'),
    });

    expect(resultado.retornos).toEqual([]);
    expect(resultado.volume).toBe(0);
    expect(resultado.metrica).toContain('não está indexado');
  });
});
