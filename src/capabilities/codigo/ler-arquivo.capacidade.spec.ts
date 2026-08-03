import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OraculoConfig } from '../../config/config.service';
import { LerArquivoCapacidade } from './ler-arquivo.capacidade';

function configFalsa(repos: string[], negados: string[]): OraculoConfig {
  return {
    escopos: { repos, comandos: [], bancos: [] },
    corpus: { fontes: [], negados },
  } as unknown as OraculoConfig;
}

const NEGADOS_PADRAO = [
  'secrets*',
  '.env*',
  '*.key',
  '*.pem',
  '*.p12',
  'id_rsa*',
  '*token*',
  '*.sqlite',
];

describe('LerArquivoCapacidade', () => {
  let repo: string;
  let fora: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'oraculo-ler-arquivo-'));
    fora = mkdtempSync(join(tmpdir(), 'oraculo-ler-arquivo-fora-'));

    execFileSync('git', ['init', '-q'], { cwd: repo });

    const linhas = Array.from({ length: 10 }, (_v, i) => `linha ${i + 1}`);
    writeFileSync(join(repo, 'normal.ts'), `${linhas.join('\n')}\n`);
    writeFileSync(join(repo, '.env'), 'SEGREDO=deveria-ficar-fora\n');
    writeFileSync(
      join(fora, 'sensivel.txt'),
      'conteudo que nunca deveria vazar para o oraculo\n',
    );
    symlinkSync(join(fora, 'sensivel.txt'), join(repo, 'atalho.txt'));
    writeFileSync(join(repo, 'binario.dat'), Buffer.from([0, 1, 2, 0, 3]));
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(fora, { recursive: true, force: true });
  });

  it('le a faixa de linhas pedida de um arquivo normal', async () => {
    const capacidade = new LerArquivoCapacidade(
      configFalsa([repo], NEGADOS_PADRAO),
    );

    const resultado = await capacidade.executar({
      caminho: join(repo, 'normal.ts'),
      inicio: 2,
      fim: 4,
    });

    expect(resultado.retornos).toHaveLength(1);
    expect(resultado.retornos[0].conteudo).toBe(
      '2: linha 2\n3: linha 3\n4: linha 4',
    );
    expect(resultado.retornos[0].origem.caminho).toBe('normal.ts');
    expect(resultado.metrica).toBe('3 linhas');
  });

  it('le o arquivo inteiro quando inicio/fim nao sao passados', async () => {
    const capacidade = new LerArquivoCapacidade(
      configFalsa([repo], NEGADOS_PADRAO),
    );

    const resultado = await capacidade.executar({
      caminho: join(repo, 'normal.ts'),
    });

    expect(resultado.volume).toBe(10);
  });

  it('recusa arquivo .env mesmo estando dentro de um repo permitido', async () => {
    const capacidade = new LerArquivoCapacidade(
      configFalsa([repo], NEGADOS_PADRAO),
    );

    const resultado = await capacidade.executar({
      caminho: join(repo, '.env'),
    });

    expect(resultado.retornos).toEqual([]);
    expect(resultado.metrica).toContain('bloqueado');
  });

  it('recusa symlink que escapa da raiz permitida', async () => {
    const capacidade = new LerArquivoCapacidade(
      configFalsa([repo], NEGADOS_PADRAO),
    );

    const resultado = await capacidade.executar({
      caminho: join(repo, 'atalho.txt'),
    });

    expect(resultado.retornos).toEqual([]);
    expect(resultado.metrica).toContain('bloqueado');
  });

  it('recusa caminho com travessia de diretorio ("..")', async () => {
    const capacidade = new LerArquivoCapacidade(
      configFalsa([repo], NEGADOS_PADRAO),
    );

    const resultado = await capacidade.executar({
      caminho: join(repo, '..', 'etc', 'passwd'),
    });

    expect(resultado.retornos).toEqual([]);
    expect(resultado.metrica).toContain('bloqueado');
  });

  it('recusa caminho relativo', async () => {
    const capacidade = new LerArquivoCapacidade(
      configFalsa([repo], NEGADOS_PADRAO),
    );

    const resultado = await capacidade.executar({ caminho: 'normal.ts' });

    expect(resultado.retornos).toEqual([]);
    expect(resultado.metrica).toContain('bloqueado');
  });

  it('recusa caminho totalmente fora de qualquer raiz permitida', async () => {
    const capacidade = new LerArquivoCapacidade(
      configFalsa([repo], NEGADOS_PADRAO),
    );

    const resultado = await capacidade.executar({
      caminho: join(fora, 'sensivel.txt'),
    });

    expect(resultado.retornos).toEqual([]);
    expect(resultado.metrica).toContain('bloqueado');
  });

  it('recusa arquivo binario', async () => {
    const capacidade = new LerArquivoCapacidade(
      configFalsa([repo], NEGADOS_PADRAO),
    );

    const resultado = await capacidade.executar({
      caminho: join(repo, 'binario.dat'),
    });

    expect(resultado.retornos).toEqual([]);
    expect(resultado.metrica).toContain('bloqueado');
  });

  it('recusa diretorio (nao e arquivo regular)', async () => {
    const capacidade = new LerArquivoCapacidade(
      configFalsa([repo], NEGADOS_PADRAO),
    );

    const resultado = await capacidade.executar({ caminho: repo });

    expect(resultado.retornos).toEqual([]);
    expect(resultado.metrica).toContain('bloqueado');
  });

  it('recusa arquivo inexistente', async () => {
    const capacidade = new LerArquivoCapacidade(
      configFalsa([repo], NEGADOS_PADRAO),
    );

    const resultado = await capacidade.executar({
      caminho: join(repo, 'fantasma.ts'),
    });

    expect(resultado.retornos).toEqual([]);
    expect(resultado.metrica).toContain('bloqueado');
  });
});
