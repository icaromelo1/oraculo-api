import {
  chmod,
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { OraculoConfig } from '../config/config.service';
import { ConfiguracaoService } from '../config/configuracao.service';
import { NEGADOS_PADRAO } from '../config/env.schema';
import {
  preverFonte,
  VarreduraService,
  varrerFontes,
} from './varredura.service';

describe('varrerFontes', () => {
  let raiz: string;

  beforeEach(async () => {
    raiz = await mkdtemp(join(tmpdir(), 'oraculo-varredura-'));

    await writeFile(join(raiz, 'normal.md'), '# Normal\nconteúdo');
    await writeFile(join(raiz, 'anotacoes.txt'), 'texto solto');
    await writeFile(join(raiz, 'secrets.local.md'), '# segredo');
    await writeFile(join(raiz, '.env'), 'CHAVE=valor');
    await writeFile(join(raiz, 'docker-compose.yml'), 'services: {}');
    await writeFile(join(raiz, 'servico.ts'), 'export const x = 1;');
    await writeFile(join(raiz, 'pacote.json'), '{}');

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
      [join(raiz, 'anotacoes.txt'), join(raiz, 'normal.md')].sort(),
    );
    expect(resultado.recusadosPelaDenylist).toBe(2);
  });

  it('não recolhe mais código-fonte nem configuração — só texto e pdf', async () => {
    const negados = NEGADOS_PADRAO.split(',');

    await writeFile(join(raiz, 'manual.pdf'), '%PDF-1.4\n');

    const resultado = await varrerFontes([raiz], negados);
    const nomes = resultado.arquivos.map((a) => basename(a.caminhoAbsoluto));

    expect(nomes.sort()).toEqual(
      ['anotacoes.txt', 'manual.pdf', 'normal.md'].sort(),
    );
    expect(nomes).not.toContain('servico.ts');
    expect(nomes).not.toContain('pacote.json');
    expect(nomes).not.toContain('docker-compose.yml');
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
      [join(raiz, 'anotacoes.txt'), join(raiz, 'normal.md')].sort(),
    );
  });
});

describe('preverFonte', () => {
  const negados = NEGADOS_PADRAO.split(',');

  let raiz: string;

  beforeEach(async () => {
    raiz = await realpath(await mkdtemp(join(tmpdir(), 'oraculo-previa-')));
  });

  afterEach(async () => {
    await rm(raiz, { recursive: true, force: true });
  });

  it('conta elegíveis, denylist, binário e vazio sem indexar nada', async () => {
    await writeFile(join(raiz, 'guia.md'), '# Guia\nconteúdo');
    await writeFile(join(raiz, 'notas.md'), '# Notas\nmais conteúdo');
    await writeFile(join(raiz, 'compose.ts'), 'export const x = 1;');
    await writeFile(join(raiz, 'secrets.local.md'), '# segredo');
    await writeFile(join(raiz, 'imagem.png'), 'não casa com padrão permitido');
    await writeFile(join(raiz, 'vazio.md'), '');
    await writeFile(
      join(raiz, 'dados.txt'),
      Buffer.from([0x7b, 0x00, 0x7d, 0x0a]),
    );

    await mkdir(join(raiz, 'node_modules', 'pacote'), { recursive: true });
    await writeFile(
      join(raiz, 'node_modules', 'pacote', 'index.js'),
      'module.exports = {};',
    );

    const previa = await preverFonte(raiz, negados);

    expect(previa.arquivosElegiveis).toBe(2);
    expect(previa.porExtensao).toEqual({ '.md': 2 });
    expect(previa.motivosDeRecusa).toEqual({
      denylist: 1,
      extensao: 2,
      vazio: 1,
      binario: 1,
    });
    expect(previa.arquivosRecusados).toBe(5);
    expect(previa.truncada).toBe(false);
    expect(previa.bytesTotais).toBeGreaterThan(0);
  });

  it('conta o arquivo negado pela denylist do mesmo jeito que a varredura real', async () => {
    await writeFile(join(raiz, 'normal.md'), '# Normal');
    await writeFile(join(raiz, 'secrets.local.md'), '# segredo');
    await mkdir(join(raiz, 'dsg-workspace'));
    await writeFile(join(raiz, 'dsg-workspace', 'doc.md'), '# não indexar');

    const previa = await preverFonte(raiz, negados);
    const varrido = await varrerFontes([raiz], negados);

    expect(previa.motivosDeRecusa.denylist).toBe(varrido.recusadosPelaDenylist);
    expect(previa.arquivosElegiveis).toBe(varrido.arquivos.length);
  });

  it('para no teto e sinaliza a varredura como truncada', async () => {
    for (let indice = 0; indice < 12; indice += 1) {
      await writeFile(join(raiz, `doc-${indice}.md`), `# doc ${indice}`);
    }

    const previa = await preverFonte(raiz, negados, { teto: 5 });

    expect(previa.truncada).toBe(true);
    expect(previa.arquivosElegiveis + previa.arquivosRecusados).toBe(5);
  });

  it('não segue link simbólico e o conta como recusado', async () => {
    const fora = await realpath(await mkdtemp(join(tmpdir(), 'oraculo-fora-')));

    await writeFile(join(fora, 'secreto.md'), '# fora da fonte');
    await symlink(fora, join(raiz, 'atalho'));
    await writeFile(join(raiz, 'dentro.md'), '# dentro');

    const previa = await preverFonte(raiz, negados);

    await rm(fora, { recursive: true, force: true });

    expect(previa.arquivosElegiveis).toBe(1);
    expect(previa.motivosDeRecusa).toEqual({ link_simbolico: 1 });
    expect(previa.amostra.map((item) => item.caminho)).toEqual([
      'dentro.md',
      'atalho',
    ]);
  });

  it('não derruba a varredura quando um subdiretório não pode ser lido', async () => {
    await writeFile(join(raiz, 'ok.md'), '# ok');
    await mkdir(join(raiz, 'fechado'));
    await writeFile(join(raiz, 'fechado', 'dentro.md'), '# dentro');

    await chmod(join(raiz, 'fechado'), 0o000);

    const previa = await preverFonte(raiz, negados);

    await chmod(join(raiz, 'fechado'), 0o755);

    expect(previa.arquivosElegiveis).toBe(1);
    expect(previa.motivosDeRecusa.permissao).toBe(1);
  });

  it('devolve amostra relativa à raiz varrida, com no máximo dez itens', async () => {
    for (let indice = 0; indice < 30; indice += 1) {
      await writeFile(join(raiz, `doc-${indice}.md`), `# doc ${indice}`);
    }

    await mkdir(join(raiz, 'sub'));
    await writeFile(join(raiz, 'sub', 'aninhado.md'), '# aninhado');

    const previa = await preverFonte(raiz, negados);

    expect(previa.amostra).toHaveLength(10);
    expect(previa.amostra.every((item) => !item.caminho.startsWith('/'))).toBe(
      true,
    );
    expect(previa.arquivosElegiveis).toBe(31);
  });
});
