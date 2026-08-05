import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  arquivoRegular,
  resolverRaizes,
  tamanhoDoArquivo,
  validarCaminhoDentroDasRaizes,
  raizesComConteudo,
} from './seguranca';

describe('seguranca do executor de codigo', () => {
  let raizRepo: string;
  let raizFora: string;

  beforeAll(() => {
    raizRepo = mkdtempSync(join(tmpdir(), 'oraculo-seguranca-repo-'));
    raizFora = mkdtempSync(join(tmpdir(), 'oraculo-seguranca-fora-'));

    mkdirSync(join(raizRepo, 'sub'), { recursive: true });
    writeFileSync(join(raizRepo, 'sub', 'arquivo.ts'), 'conteudo normal\n');
    writeFileSync(join(raizFora, 'alvo.txt'), 'conteudo fora da raiz\n');
    symlinkSync(join(raizFora, 'alvo.txt'), join(raizRepo, 'vazamento.txt'));
    mkdirSync(join(raizRepo, 'diretorio'), { recursive: true });
  });

  afterAll(() => {
    rmSync(raizRepo, { recursive: true, force: true });
    rmSync(raizFora, { recursive: true, force: true });
  });

  it('resolve a raiz real via realpath', () => {
    const raizes = resolverRaizes([raizRepo]);
    expect(raizes).toHaveLength(1);
    expect(raizes[0].original).toBe(raizRepo);
  });

  it('ignora raiz que nao existe no disco', () => {
    const raizes = resolverRaizes([join(raizRepo, 'nao-existe')]);
    expect(raizes).toHaveLength(0);
  });

  it('valida arquivo normal dentro da raiz', () => {
    const raizes = resolverRaizes([raizRepo]);
    const validado = validarCaminhoDentroDasRaizes(
      join(raizRepo, 'sub', 'arquivo.ts'),
      raizes,
    );
    expect(validado).not.toBeNull();
    expect(validado?.relativo).toBe(join('sub', 'arquivo.ts'));
  });

  it('rejeita symlink que escapa da raiz para fora', () => {
    const raizes = resolverRaizes([raizRepo]);
    const validado = validarCaminhoDentroDasRaizes(
      join(raizRepo, 'vazamento.txt'),
      raizes,
    );
    expect(validado).toBeNull();
  });

  it('rejeita caminho relativo', () => {
    const raizes = resolverRaizes([raizRepo]);
    expect(validarCaminhoDentroDasRaizes('sub/arquivo.ts', raizes)).toBeNull();
  });

  it('rejeita caminho com travessia de diretorio', () => {
    const raizes = resolverRaizes([raizRepo]);
    expect(
      validarCaminhoDentroDasRaizes(
        join(
          raizRepo,
          '..',
          'oraculo-seguranca-repo',
          'sub',
          '..',
          '..',
          'etc',
          'hosts',
        ),
        raizes,
      ),
    ).toBeNull();
  });

  it('rejeita caminho que nao existe no disco', () => {
    const raizes = resolverRaizes([raizRepo]);
    expect(
      validarCaminhoDentroDasRaizes(join(raizRepo, 'fantasma.ts'), raizes),
    ).toBeNull();
  });

  it('rejeita caminho totalmente fora de qualquer raiz', () => {
    const raizes = resolverRaizes([raizRepo]);
    expect(
      validarCaminhoDentroDasRaizes(join(raizFora, 'alvo.txt'), raizes),
    ).toBeNull();
  });

  it('arquivoRegular aceita arquivo comum e rejeita diretorio', () => {
    expect(arquivoRegular(join(raizRepo, 'sub', 'arquivo.ts'))).toBe(true);
    expect(arquivoRegular(join(raizRepo, 'diretorio'))).toBe(false);
  });

  it('arquivoRegular rejeita caminho inexistente', () => {
    expect(arquivoRegular(join(raizRepo, 'fantasma.ts'))).toBe(false);
  });

  it('tamanhoDoArquivo devolve o tamanho real e null para inexistente', () => {
    expect(
      tamanhoDoArquivo(join(raizRepo, 'sub', 'arquivo.ts')),
    ).toBeGreaterThan(0);
    expect(tamanhoDoArquivo(join(raizRepo, 'fantasma.ts'))).toBeNull();
  });
});

describe('raizesComConteudo', () => {
  let raiz: string;

  beforeEach(async () => {
    raiz = await mkdtemp(join(tmpdir(), 'oraculo-raiz-'));
  });

  afterEach(async () => {
    await rm(raiz, { recursive: true, force: true });
  });

  it('não conta raiz que existe mas está vazia', () => {
    expect(raizesComConteudo([raiz])).toEqual([]);
  });

  it('conta raiz com pelo menos um arquivo', async () => {
    await writeFile(join(raiz, 'a.ts'), 'const a = 1;');

    expect(raizesComConteudo([raiz])).toHaveLength(1);
  });

  it('não conta raiz inexistente', () => {
    expect(raizesComConteudo([join(raiz, 'nao-existe')])).toEqual([]);
  });
});
