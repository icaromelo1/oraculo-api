import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Repository } from 'typeorm';
import { OraculoConfig } from '../config/config.service';
import { Documento, Trecho } from '../database/entities';
import { EmbeddingService } from './embedding.service';
import { IndexacaoService } from './indexacao.service';
import { VarreduraService } from './varredura.service';

function criarRepositorioDeDocumentos() {
  const dados: Documento[] = [];

  return {
    findOne: jest.fn((opcoes: { where: { caminho?: string } }) =>
      Promise.resolve(
        dados.find((item) => item.caminho === opcoes.where.caminho) ?? null,
      ),
    ),
    save: jest.fn((dado: Partial<Documento>) => {
      const indice = dados.findIndex((item) => item.id === dado.id);
      const gravado = {
        ...dado,
        id: dado.id ?? randomUUID(),
      } as Documento;

      if (indice >= 0) {
        dados[indice] = gravado;
      } else {
        dados.push(gravado);
      }

      return Promise.resolve({ ...gravado });
    }),
    delete: jest.fn(() => Promise.resolve({ affected: 1 })),
    dados,
  };
}

function criarRepositorioDeTrechos() {
  return {
    create: jest.fn((dado: Partial<Trecho>) => ({ ...dado }) as Trecho),
    save: jest.fn((dados: Trecho[]) => Promise.resolve(dados)),
    createQueryBuilder: jest.fn(() => ({
      delete: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn(() => Promise.resolve({ affected: 0 })),
    })),
  };
}

function montar() {
  const documentos = criarRepositorioDeDocumentos();
  const trechos = criarRepositorioDeTrechos();

  const embedding = {
    embutir: jest.fn((textos: string[]) =>
      Promise.resolve(textos.map(() => [0.1, 0.2, 0.3])),
    ),
  } as unknown as EmbeddingService;

  const config = {
    corpus: { fontes: [], negados: [], notas: null, exibicao: [] },
  } as unknown as OraculoConfig;

  const servico = new IndexacaoService(
    {} as unknown as VarreduraService,
    embedding,
    documentos as unknown as Repository<Documento>,
    trechos as unknown as Repository<Trecho>,
    config,
  );

  return { servico, documentos, trechos };
}

describe('IndexacaoService — a varredura não conhece módulo nem descrição', () => {
  let raiz: string;
  let arquivo: string;

  beforeEach(async () => {
    raiz = await mkdtemp(join(tmpdir(), 'oraculo-indexacao-'));
    arquivo = join(raiz, 'nota.md');
    await writeFile(arquivo, '# nota\n\nconteúdo original da nota\n');
  });

  afterEach(async () => {
    await rm(raiz, { recursive: true, force: true });
  });

  it('indexa arquivo novo sem módulo e sem descrição', async () => {
    const { servico, documentos } = montar();

    const resultado = await servico.indexarArquivo(arquivo);

    expect(resultado.status).toBe('novo');
    expect(documentos.dados[0].moduloId).toBeNull();
    expect(documentos.dados[0].descricao).toBeNull();
  });

  it('reindexação de arquivo alterado preserva o módulo e a descrição', async () => {
    const { servico, documentos } = montar();

    await servico.indexarArquivo(arquivo);

    documentos.dados[0].moduloId = 'modulo-da-memoria';
    documentos.dados[0].descricao = 'o que o dono decidiu sobre deploy';

    await writeFile(
      arquivo,
      '# nota\n\nconteúdo trocado depois da curadoria\n',
    );

    const resultado = await servico.indexarArquivo(arquivo);

    expect(resultado.status).toBe('atualizado');
    expect(documentos.dados).toHaveLength(1);
    expect(documentos.dados[0].moduloId).toBe('modulo-da-memoria');
    expect(documentos.dados[0].descricao).toBe(
      'o que o dono decidiu sobre deploy',
    );
  });

  it('arquivo inalterado não toca no documento', async () => {
    const { servico, documentos } = montar();

    await servico.indexarArquivo(arquivo);

    documentos.dados[0].moduloId = 'modulo-da-memoria';
    documentos.save.mockClear();

    const resultado = await servico.indexarArquivo(arquivo);

    expect(resultado.status).toBe('inalterado');
    expect(documentos.save).not.toHaveBeenCalled();
    expect(documentos.dados[0].moduloId).toBe('modulo-da-memoria');
  });
});
