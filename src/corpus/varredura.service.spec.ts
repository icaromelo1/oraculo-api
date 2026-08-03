import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NEGADOS_PADRAO } from '../config/env.schema';
import { varrerFontes } from './varredura.service';

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
});
