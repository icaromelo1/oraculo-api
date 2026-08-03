import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { OraculoConfig } from '../../config/config.service';
import { BuscarCodigoCapacidade } from './buscar-codigo.capacidade';
import { analisarSaidaDoGrep } from './git-grep';
import { validarCaminhoDentroDasRaizes, resolverRaizes } from './seguranca';

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

describe('BuscarCodigoCapacidade', () => {
  let repo: string;
  let fora: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'oraculo-buscar-codigo-'));
    fora = mkdtempSync(join(tmpdir(), 'oraculo-buscar-codigo-fora-'));

    execFileSync('git', ['init', '-q'], { cwd: repo });

    mkdirSync(join(repo, 'sub'), { recursive: true });
    writeFileSync(
      join(repo, 'sub', 'codigo.ts'),
      "const padraoAlvoUnico123 = 'ok';\n",
    );
    writeFileSync(join(repo, '.env'), 'TOKEN=abc\npadraoAlvoUnico123\n');
    writeFileSync(
      join(fora, 'alvo.txt'),
      'sentinelaForaDaRaiz999 nunca deveria aparecer aqui\n',
    );
    symlinkSync(join(fora, 'alvo.txt'), join(repo, 'vazamento.txt'));
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(fora, { recursive: true, force: true });
  });

  it('encontra o padrao no arquivo normal, com numero de linha', async () => {
    const capacidade = new BuscarCodigoCapacidade(
      configFalsa([repo], NEGADOS_PADRAO),
    );

    const resultado = await capacidade.executar({
      padrao: 'padraoAlvoUnico123',
    });

    const caminhos = resultado.retornos.map(
      (retorno) => retorno.origem.caminho,
    );
    expect(caminhos).toContain(join('sub', 'codigo.ts'));

    const doArquivo = resultado.retornos.find(
      (retorno) => retorno.origem.caminho === join('sub', 'codigo.ts'),
    );
    expect(doArquivo?.conteudo).toContain('1: ');
    expect(doArquivo?.origem.meta).toContain('linhas');
  });

  it('nunca devolve linhas do .env mesmo quando ele bate com o padrao', async () => {
    const capacidade = new BuscarCodigoCapacidade(
      configFalsa([repo], NEGADOS_PADRAO),
    );

    const resultado = await capacidade.executar({
      padrao: 'padraoAlvoUnico123',
    });

    const caminhos = resultado.retornos.map(
      (retorno) => retorno.origem.caminho,
    );
    expect(caminhos).not.toContain('.env');
    expect(
      resultado.retornos.every(
        (retorno) => !retorno.conteudo.includes('TOKEN=abc'),
      ),
    ).toBe(true);
  });

  it('nunca vaza o conteudo do symlink que escapa da raiz', async () => {
    const capacidade = new BuscarCodigoCapacidade(
      configFalsa([repo], NEGADOS_PADRAO),
    );

    const resultado = await capacidade.executar({
      padrao: 'sentinelaForaDaRaiz999',
    });

    expect(resultado.retornos).toHaveLength(0);
    expect(
      resultado.retornos.every(
        (retorno) => !retorno.conteudo.includes('sentinelaForaDaRaiz999'),
      ),
    ).toBe(true);
  });

  it(
    'defesa em profundidade: mesmo se o git listasse o caminho do symlink, ' +
      'a validacao por realpath descartaria o resultado antes de virar retorno',
    () => {
      const saidaSimulada = `vazamento.txt:1:sentinelaForaDaRaiz999 nunca deveria aparecer aqui`;
      const porArquivo = analisarSaidaDoGrep(saidaSimulada);
      const raizes = resolverRaizes([repo]);
      const [raiz] = raizes;

      expect(porArquivo.has('vazamento.txt')).toBe(true);

      const caminhoAbsoluto = resolve(raiz.real, 'vazamento.txt');
      const validado = validarCaminhoDentroDasRaizes(caminhoAbsoluto, [raiz]);

      expect(validado).toBeNull();
    },
  );

  it('respeita o limite maximo de arquivos no retorno', async () => {
    const repoGrande = mkdtempSync(
      join(tmpdir(), 'oraculo-buscar-codigo-grande-'),
    );
    execFileSync('git', ['init', '-q'], { cwd: repoGrande });

    for (let indice = 0; indice < 25; indice += 1) {
      writeFileSync(
        join(repoGrande, `arquivo-${indice}.ts`),
        'const marcaComumParaTeste = true;\n',
      );
    }

    const capacidade = new BuscarCodigoCapacidade(
      configFalsa([repoGrande], NEGADOS_PADRAO),
    );

    const resultado = await capacidade.executar({
      padrao: 'marcaComumParaTeste',
      limite: 999,
    });

    expect(resultado.retornos.length).toBeLessThanOrEqual(20);

    rmSync(repoGrande, { recursive: true, force: true });
  });

  it('restringe a busca ao repo pedido quando ele esta na lista', async () => {
    const outroRepo = mkdtempSync(
      join(tmpdir(), 'oraculo-buscar-codigo-outro-'),
    );
    execFileSync('git', ['init', '-q'], { cwd: outroRepo });
    writeFileSync(
      join(outroRepo, 'somente-aqui.ts'),
      'const marcaExclusivaDoOutroRepo = 1;\n',
    );

    const capacidade = new BuscarCodigoCapacidade(
      configFalsa([repo, outroRepo], NEGADOS_PADRAO),
    );

    const resultadoRestrito = await capacidade.executar({
      padrao: 'marcaExclusivaDoOutroRepo',
      repo,
    });
    expect(resultadoRestrito.retornos).toHaveLength(0);

    const resultadoCorreto = await capacidade.executar({
      padrao: 'marcaExclusivaDoOutroRepo',
      repo: outroRepo,
    });
    expect(resultadoCorreto.retornos).toHaveLength(1);

    rmSync(outroRepo, { recursive: true, force: true });
  });

  it('nao executa nada quando o padrao traz metacaracteres de shell', async () => {
    const marcador = join(
      tmpdir(),
      `oraculo-marcador-${process.pid}-${Date.now()}.txt`,
    );
    rmSync(marcador, { force: true });

    const capacidade = new BuscarCodigoCapacidade(
      configFalsa([repo], NEGADOS_PADRAO),
    );

    const padraoHostil = `padraoAlvoUnico123; touch ${marcador}`;
    const padraoHostil2 = `$(touch ${marcador})`;
    const padraoHostil3 = `\`touch ${marcador}\``;

    await capacidade.executar({ padrao: padraoHostil });
    await capacidade.executar({ padrao: padraoHostil2 });
    const resultado = await capacidade.executar({ padrao: padraoHostil3 });

    expect(existsSync(marcador)).toBe(false);
    expect(resultado.retornos).toEqual([]);
  });
});
