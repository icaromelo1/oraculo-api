import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { homedir } from 'os';

interface RepoMetadata {
  name: string;
  archived: boolean;
  fork: boolean;
}

const TOKEN_GITHUB = process.env.GITHUB_TOKEN;

interface RelatorioSync {
  docsCopiadasCount: number;
  reposClonados: string[];
  reposAtualizados: string[];
  repositoriosPulados: Array<{ nome: string; motivo: string }>;
  falhas: Array<{ repositorio: string; motivo: string }>;
}

const WORKSPACE_HOME = path.join(homedir(), 'oraculo-workspace');
const DOCS_DIR = path.join(WORKSPACE_HOME, 'docs');
const REPOS_DIR = path.join(WORKSPACE_HOME, 'repos');

function criarDiretoriosSeNecessario(): void {
  if (!fs.existsSync(WORKSPACE_HOME)) {
    fs.mkdirSync(WORKSPACE_HOME, { recursive: true });
  }
  if (!fs.existsSync(DOCS_DIR)) {
    fs.mkdirSync(DOCS_DIR, { recursive: true });
  }
  if (!fs.existsSync(REPOS_DIR)) {
    fs.mkdirSync(REPOS_DIR, { recursive: true });
  }
}

function sincronizarDocs(): number {
  const origemEnv = process.env.STACK_DOCS_ORIGEM || '';
  if (!origemEnv.trim()) {
    console.log(
      '⚠️  STACK_DOCS_ORIGEM não definida. Pulando sincronização de docs.',
    );
    return 0;
  }

  const origens = origemEnv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  let docsCopiadasCount = 0;

  for (const origem of origens) {
    if (!fs.existsSync(origem)) {
      console.log(`⚠️  Origem de docs não existe: ${origem}. Continuando...`);
      continue;
    }

    if (!fs.statSync(origem).isDirectory()) {
      console.log(`⚠️  Origem não é um diretório: ${origem}. Continuando...`);
      continue;
    }

    const arquivos = buscarArquivosMarkdown(origem);
    for (const arquivo of arquivos) {
      const relativo = path.relative(origem, arquivo);
      const destino = path.join(DOCS_DIR, relativo);

      const dirDestino = path.dirname(destino);
      if (!fs.existsSync(dirDestino)) {
        fs.mkdirSync(dirDestino, { recursive: true });
      }

      fs.copyFileSync(arquivo, destino);
      docsCopiadasCount++;
    }
  }

  return docsCopiadasCount;
}

function buscarArquivosMarkdown(diretorio: string): string[] {
  const arquivos: string[] = [];

  function percorrer(dir: string): void {
    const entradas = fs.readdirSync(dir);
    for (const entrada of entradas) {
      const caminhoCompleto = path.join(dir, entrada);
      const stats = fs.statSync(caminhoCompleto);

      if (stats.isDirectory()) {
        percorrer(caminhoCompleto);
      } else if (path.extname(entrada) === '.md') {
        arquivos.push(caminhoCompleto);
      }
    }
  }

  percorrer(diretorio);
  return arquivos;
}

async function obterRepositoriosGitHub(
  usuario: string,
  token?: string,
): Promise<Array<{ name: string; archived: boolean; fork: boolean }>> {
  const repositorios: Array<{
    name: string;
    archived: boolean;
    fork: boolean;
  }> = [];
  let pagina = 1;
  const porPagina = 100;
  let temMais = true;

  while (temMais) {
    const url = token
      ? `https://api.github.com/user/repos?per_page=${porPagina}&page=${pagina}`
      : `https://api.github.com/users/${usuario}/repos?per_page=${porPagina}&page=${pagina}`;

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
    };

    if (token) {
      headers['Authorization'] = `token ${token}`;
    }

    try {
      const resposta = await fetch(url, { headers });

      if (!resposta.ok) {
        throw new Error(`Status ${resposta.status}: ${resposta.statusText}`);
      }

      const dados = (await resposta.json()) as RepoMetadata[];

      if (!Array.isArray(dados) || dados.length === 0) {
        temMais = false;
        break;
      }

      for (const repo of dados) {
        repositorios.push({
          name: repo.name,
          archived: repo.archived || false,
          fork: repo.fork || false,
        });
      }

      pagina++;
    } catch (erro) {
      console.error(
        `Erro ao buscar repositórios da página ${pagina}: ${erro instanceof Error ? erro.message : String(erro)}`,
      );
      temMais = false;
    }
  }

  return repositorios;
}

function sincronizarRepositorio(
  nomeRepo: string,
  usuario: string,
  token?: string,
): {
  status: 'clonado' | 'atualizado' | 'pulado' | 'erro';
  mensagem?: string;
} {
  const caminhoRepo = path.join(REPOS_DIR, nomeRepo);
  const urlRepo = montarUrlRepositorio(usuario, nomeRepo, token);

  if (fs.existsSync(caminhoRepo)) {
    const resultado = atualizarRepositorio(caminhoRepo);
    return resultado;
  }

  const resultado = clonarRepositorio(caminhoRepo, urlRepo);
  return resultado;
}

function montarUrlRepositorio(
  usuario: string,
  nomeRepo: string,
  token?: string,
): string {
  if (token) {
    return `https://${token}@github.com/${usuario}/${nomeRepo}.git`;
  }
  return `https://github.com/${usuario}/${nomeRepo}.git`;
}

function clonarRepositorio(
  caminho: string,
  url: string,
): { status: 'clonado' | 'erro'; mensagem?: string } {
  const resultado = spawnSync('git', ['clone', '--depth', '50', url, caminho], {
    stdio: 'pipe',
    encoding: 'utf-8',
  });

  if (resultado.error) {
    return {
      status: 'erro',
      mensagem: mascararToken(`Erro ao clonar: ${resultado.error.message}`),
    };
  }

  if (resultado.status !== 0) {
    const stderr = resultado.stderr || resultado.stdout || '';
    return {
      status: 'erro',
      mensagem: mascararToken(
        `Git retornou status ${resultado.status}: ${stderr}`,
      ),
    };
  }

  return { status: 'clonado' };
}

function atualizarRepositorio(caminho: string): {
  status: 'atualizado' | 'erro';
  mensagem?: string;
} {
  const fetchResposta = spawnSync('git', ['fetch'], {
    cwd: caminho,
    stdio: 'pipe',
    encoding: 'utf-8',
  });

  if (fetchResposta.status !== 0) {
    const stderr = fetchResposta.stderr || fetchResposta.stdout || '';
    return {
      status: 'erro',
      mensagem: `Erro em git fetch: ${stderr}`,
    };
  }

  const branchResposta = spawnSync(
    'git',
    ['rev-parse', '--abbrev-ref', 'origin/HEAD'],
    {
      cwd: caminho,
      stdio: 'pipe',
      encoding: 'utf-8',
    },
  );

  let branchPadrao = 'main';
  if (branchResposta.status === 0 && branchResposta.stdout) {
    const match = branchResposta.stdout.trim().match(/origin\/(.+)$/);
    if (match) {
      branchPadrao = match[1];
    }
  }

  const resetResposta = spawnSync(
    'git',
    ['reset', '--hard', `origin/${branchPadrao}`],
    {
      cwd: caminho,
      stdio: 'pipe',
      encoding: 'utf-8',
    },
  );

  if (resetResposta.status !== 0) {
    const stderr = resetResposta.stderr || resetResposta.stdout || '';
    return {
      status: 'erro',
      mensagem: `Erro em git reset: ${stderr}`,
    };
  }

  return { status: 'atualizado' };
}

function mascararToken(texto: string): string {
  if (!TOKEN_GITHUB || !texto) {
    return texto;
  }
  return texto.split(TOKEN_GITHUB).join('***');
}

async function executarSync(): Promise<void> {
  const relatorio: RelatorioSync = {
    docsCopiadasCount: 0,
    reposClonados: [],
    reposAtualizados: [],
    repositoriosPulados: [],
    falhas: [],
  };

  console.log('🚀 Iniciando sincronização da stack...\n');

  criarDiretoriosSeNecessario();
  console.log(`📁 Workspace: ${WORKSPACE_HOME}\n`);

  console.log('📚 Sincronizando documentação...');
  relatorio.docsCopiadasCount = sincronizarDocs();
  console.log(
    `✅ ${relatorio.docsCopiadasCount} arquivo(s) de documentação copiado(s).\n`,
  );

  const usuario = process.env.GITHUB_USUARIO || 'icaroMelo1';
  const token = process.env.GITHUB_TOKEN;

  console.log(`🔍 Buscando repositórios de ${usuario}...`);
  const repositorios = await obterRepositoriosGitHub(usuario, token);
  console.log(`✅ ${repositorios.length} repositório(s) encontrado(s).\n`);

  console.log('🔄 Sincronizando repositórios...');
  for (const repo of repositorios) {
    if (repo.archived) {
      relatorio.repositoriosPulados.push({
        nome: repo.name,
        motivo: 'Repositório arquivado',
      });
      console.log(`⏭️  ${repo.name} (arquivado)`);
      continue;
    }

    if (repo.fork) {
      relatorio.repositoriosPulados.push({
        nome: repo.name,
        motivo: 'Fork',
      });
      console.log(`⏭️  ${repo.name} (fork)`);
      continue;
    }

    const resultado = sincronizarRepositorio(repo.name, usuario, token);

    if (resultado.status === 'clonado') {
      relatorio.reposClonados.push(repo.name);
      console.log(`📥 ${repo.name} (clonado)`);
    } else if (resultado.status === 'atualizado') {
      relatorio.reposAtualizados.push(repo.name);
      console.log(`🔄 ${repo.name} (atualizado)`);
    } else {
      relatorio.falhas.push({
        repositorio: repo.name,
        motivo: resultado.mensagem || 'Erro desconhecido',
      });
      console.log(`❌ ${repo.name} (erro: ${resultado.mensagem})`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 RESUMO DA SINCRONIZAÇÃO');
  console.log('='.repeat(60));
  console.log(`📚 Documentação: ${relatorio.docsCopiadasCount} arquivo(s)`);
  console.log(`📥 Repositórios clonados: ${relatorio.reposClonados.length}`);
  if (relatorio.reposClonados.length > 0) {
    relatorio.reposClonados.forEach((r) => console.log(`   - ${r}`));
  }
  console.log(
    `🔄 Repositórios atualizados: ${relatorio.reposAtualizados.length}`,
  );
  if (relatorio.reposAtualizados.length > 0) {
    relatorio.reposAtualizados.forEach((r) => console.log(`   - ${r}`));
  }
  console.log(
    `⏭️  Repositórios pulados: ${relatorio.repositoriosPulados.length}`,
  );
  if (relatorio.repositoriosPulados.length > 0) {
    relatorio.repositoriosPulados.forEach((r) =>
      console.log(`   - ${r.nome} (${r.motivo})`),
    );
  }
  console.log(`❌ Falhas: ${relatorio.falhas.length}`);
  if (relatorio.falhas.length > 0) {
    relatorio.falhas.forEach((f) =>
      console.log(`   - ${f.repositorio}: ${f.motivo}`),
    );
  }
  console.log('='.repeat(60));
}

executarSync().catch((erro) => {
  console.error('Erro fatal:', erro);
  process.exit(1);
});
