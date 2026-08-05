import 'reflect-metadata';
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import type { OraculoConfig } from '../../config/config.service';
import { EmbeddingService } from '../../corpus/embedding.service';
import { IndexacaoService } from '../../corpus/indexacao.service';
import { VarreduraService } from '../../corpus/varredura.service';
import { Documento, entidades, Trecho } from '../../database/entities';
import {
  CONTEUDO_CONFIG,
  CONTEUDO_DOC,
  CONTEUDO_MEMORIA,
} from './fixture.conteudo';

async function main() {
  const raiz = process.argv[2];
  const consulta = process.argv[3];
  const arquivoSaida = process.argv[4];

  if (!raiz || !consulta || !arquivoSaida) {
    throw new Error(
      'uso: gerar-fixture-teste.ts <raiz> <consulta> <arquivoSaida>',
    );
  }

  await mkdir(join(raiz, '.claude', 'projects', '-teste', 'memory'), {
    recursive: true,
  });
  await mkdir(join(raiz, 'infra'), { recursive: true });
  await mkdir(join(raiz, 'docs'), { recursive: true });

  const caminhoMemoria = join(
    raiz,
    '.claude',
    'projects',
    '-teste',
    'memory',
    'reference_rotacao_chave.md',
  );
  const caminhoConfig = join(raiz, 'infra', 'docker-compose.yml');
  const caminhoDoc = join(raiz, 'docs', 'observacoes.md');

  await writeFile(caminhoMemoria, CONTEUDO_MEMORIA);
  await writeFile(caminhoConfig, CONTEUDO_CONFIG);
  await writeFile(caminhoDoc, CONTEUDO_DOC);

  const config = {
    corpus: { fontes: [raiz], negados: [] },
    recuperacao: {
      modo: 'hibrido',
      modeloEmbedding: 'Xenova/multilingual-e5-small',
      dimensoes: 384,
    },
  } as unknown as OraculoConfig;

  const dataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    entities: entidades,
  });
  await dataSource.initialize();

  const documentoRepo = dataSource.getRepository(Documento);
  const trechoRepo = dataSource.getRepository(Trecho);
  const embedding = new EmbeddingService(config);
  const varredura = new VarreduraService(config);
  const indexacao = new IndexacaoService(
    varredura,
    embedding,
    documentoRepo,
    trechoRepo,
    config,
  );

  const resumo = await indexacao.executar();
  const [vetorConsulta] = await embedding.embutir([consulta], {
    prefixo: 'query',
  });

  await dataSource.destroy();

  await writeFile(
    arquivoSaida,
    JSON.stringify({
      caminhoMemoria,
      caminhoConfig,
      caminhoDoc,
      resumo,
      vetorConsulta,
    }),
  );
}

main().catch((erro: unknown) => {
  process.stderr.write(
    erro instanceof Error ? (erro.stack ?? erro.message) : String(erro),
  );
  process.exit(1);
});
