import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OraculoConfig } from '../config/config.service';
import { ConfiguracaoService } from '../config/configuracao.service';
import { NEGADOS_PADRAO } from '../config/env.schema';
import { VarreduraService, varrerFontes } from './varredura.service';

describe('varrerFontes', () => {
  let raiz: string;

  beforeEach(async () => {
    raiz = await mkdtemp(join(tmpdir(), 'oraculo-varredura-'));

    await writeFile(join(raiz, 'normal.md'), '# Normal\nconteúdo');
    await writeFile(join(raiz, 'secrets.local.md'), '# segredo');
    await writeFile(join(raiz, '.env'), 'CHAVE=valor');
    await writeFile(join(raiz, 'docker-compose.yml'), 'services: {}');

    await mkdir(join(raiz, 'dsg-workspace'));
    await writeFile(
      join(raiz, 'dsg-workspace', 'doc.md'),
      '# não indexar isso',
    );

    await mkdir(join(raiz, 'node_modules', 'pacote'), { recursive: true });
    await writeFile(
      join(raiz, 'node_modules', 'pacote', 'index.js'),
      'module.exports = {};',
    );
  });

  afterEach(async () => {
    await rm(raiz, { recursive: true, force: true });
  });

  it('indexa apenas os caminhos permitidos, recusando denylist e node_modules', async () => {
    const negados = NEGADOS_PADRAO.split(',');
    const resultado = await varrerFontes([raiz], negados);

    const caminhos = resultado.arquivos.map((a) => a.caminhoAbsoluto).sort();

    expect(caminhos).toEqual(
      [join(raiz, 'docker-compose.yml'), join(raiz, 'normal.md')].sort(),
    );
    expect(resultado.recusadosPelaDenylist).toBe(2);
  });

  it('varre as fontes efetivas do ConfiguracaoService, não as do ENV', async () => {
    const config = {
      corpus: {
        fontes: ['/caminho/que/nao/existe'],
        negados: NEGADOS_PADRAO.split(','),
      },
    } as unknown as OraculoConfig;

    const configuracao = {
      fontesEfetivas: jest.fn().mockResolvedValue([
        {
          id: null,
          caminho: raiz,
          rotulo: 'raiz',
          origem: 'banco',
          removivel: true,
        },
      ]),
    } as unknown as ConfiguracaoService;

    const resultado = await new VarreduraService(config, configuracao).varrer();

    expect(resultado.arquivos.map((a) => a.caminhoAbsoluto).sort()).toEqual(
      [join(raiz, 'docker-compose.yml'), join(raiz, 'normal.md')].sort(),
    );
  });
});
