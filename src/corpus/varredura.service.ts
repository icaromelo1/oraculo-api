import { Injectable, Optional } from '@nestjs/common';
import fg from 'fast-glob';
import type { Dirent } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { pareceBinario } from '../capabilities/codigo/binario';
import { OraculoConfig } from '../config/config.service';
import { ConfiguracaoService } from '../config/configuracao.service';
import { caminhoNegado, casaAlgumPadrao } from './denylist';

const NOMES_PERMITIDOS = [
  '*.md',
  '*.yml',
  '*.yaml',
  '*.conf',
  '*.json',
  '*.ts',
  '*.js',
  '*.sh',
  'Dockerfile',
  'Dockerfile.*',
  'docker-compose*.yml',
  'docker-compose*.yaml',
];

const PADROES_PERMITIDOS = NOMES_PERMITIDOS.map((nome) => `**/${nome}`);

const DIRETORIOS_IGNORADOS = ['node_modules', '.git', 'dist'];

const IGNORADOS_SEMPRE = DIRETORIOS_IGNORADOS.map((nome) => `**/${nome}/**`);

const TETO_DE_ARQUIVOS = 20_000;
const ITENS_NA_AMOSTRA = 10;
const RECUSADOS_NA_AMOSTRA = 3;
const JANELA_DE_LEITURA = 8000;

export interface ArquivoEncontrado {
  caminhoAbsoluto: string;
}

export interface ResultadoVarredura {
  arquivos: ArquivoEncontrado[];
  recusadosPelaDenylist: number;
}

export type MotivoDeRecusa =
  | 'denylist'
  | 'extensao'
  | 'binario'
  | 'vazio'
  | 'permissao'
  | 'link_simbolico';

export interface ItemDaAmostra {
  caminho: string;
  bytes: number;
  motivo?: MotivoDeRecusa;
}

export interface PreviaDaFonte {
  arquivosElegiveis: number;
  arquivosRecusados: number;
  bytesTotais: number;
  porExtensao: Record<string, number>;
  amostra: ItemDaAmostra[];
  motivosDeRecusa: Record<string, number>;
  truncada: boolean;
}

export interface OpcoesDePrevia {
  teto?: number;
  itensNaAmostra?: number;
}

@Injectable()
export class VarreduraService {
  constructor(
    private readonly config: OraculoConfig,
    @Optional() private readonly configuracao?: ConfiguracaoService,
  ) {}

  async varrer(): Promise<ResultadoVarredura> {
    const caminhos = this.configuracao
      ? (await this.configuracao.fontesEfetivas()).map((fonte) => fonte.caminho)
      : this.config.corpus.fontes;

    const notas = this.config.corpus.notas;

    return varrerFontes(
      notas ? [...caminhos, notas] : caminhos,
      this.config.corpus.negados,
    );
  }
}

export async function varrerFontes(
  fontes: readonly string[],
  negados: readonly string[],
): Promise<ResultadoVarredura> {
  const arquivos: ArquivoEncontrado[] = [];
  const vistos = new Set<string>();
  let recusadosPelaDenylist = 0;

  for (const raiz of fontes) {
    const raizAbsoluta = resolve(raiz);

    const candidatos = await fg(PADROES_PERMITIDOS, {
      cwd: raizAbsoluta,
      onlyFiles: true,
      dot: true,
      absolute: true,
      followSymbolicLinks: false,
      ignore: IGNORADOS_SEMPRE,
    });

    for (const caminhoAbsoluto of candidatos) {
      if (vistos.has(caminhoAbsoluto)) continue;
      vistos.add(caminhoAbsoluto);

      const caminhoRelativo = relative(raizAbsoluta, caminhoAbsoluto);

      if (caminhoNegado(caminhoRelativo, negados)) {
        recusadosPelaDenylist += 1;
        continue;
      }

      arquivos.push({ caminhoAbsoluto });
    }
  }

  return { arquivos, recusadosPelaDenylist };
}

async function tamanhoDe(caminhoAbsoluto: string): Promise<number | null> {
  try {
    return (await stat(caminhoAbsoluto)).size;
  } catch {
    return null;
  }
}

async function lerCabeca(
  caminhoAbsoluto: string,
  tamanho: number,
): Promise<Buffer | null> {
  const handle = await open(caminhoAbsoluto, 'r').catch(() => null);

  if (!handle) {
    return null;
  }

  try {
    const buffer = Buffer.alloc(Math.min(tamanho, JANELA_DE_LEITURA));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);

    return buffer.subarray(0, bytesRead);
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function chaveDaExtensao(nome: string): string {
  return extname(nome).toLowerCase() || nome.toLowerCase();
}

export async function preverFonte(
  raiz: string,
  negados: readonly string[],
  opcoes: OpcoesDePrevia = {},
): Promise<PreviaDaFonte> {
  const raizAbsoluta = resolve(raiz);
  const teto = opcoes.teto ?? TETO_DE_ARQUIVOS;
  const itensNaAmostra = opcoes.itensNaAmostra ?? ITENS_NA_AMOSTRA;

  const porExtensao: Record<string, number> = {};
  const motivosDeRecusa: Record<string, number> = {};
  const elegiveisDaAmostra: ItemDaAmostra[] = [];
  const recusadosDaAmostra: ItemDaAmostra[] = [];

  let arquivosElegiveis = 0;
  let arquivosRecusados = 0;
  let bytesTotais = 0;
  let examinados = 0;
  let truncada = false;

  async function recusar(
    motivo: MotivoDeRecusa,
    caminhoRelativo: string,
    bytes?: number,
  ): Promise<void> {
    arquivosRecusados += 1;
    motivosDeRecusa[motivo] = (motivosDeRecusa[motivo] ?? 0) + 1;

    if (recusadosDaAmostra.length >= RECUSADOS_NA_AMOSTRA) {
      return;
    }

    recusadosDaAmostra.push({
      caminho: caminhoRelativo,
      bytes:
        bytes ?? (await tamanhoDe(join(raizAbsoluta, caminhoRelativo))) ?? 0,
      motivo,
    });
  }

  function aceitar(nome: string, caminhoRelativo: string, bytes: number): void {
    arquivosElegiveis += 1;
    bytesTotais += bytes;

    const chave = chaveDaExtensao(nome);
    porExtensao[chave] = (porExtensao[chave] ?? 0) + 1;

    if (elegiveisDaAmostra.length < itensNaAmostra) {
      elegiveisDaAmostra.push({ caminho: caminhoRelativo, bytes });
    }
  }

  async function examinarArquivo(
    entrada: Dirent,
    caminhoAbsoluto: string,
    caminhoRelativo: string,
  ): Promise<void> {
    if (!casaAlgumPadrao(entrada.name, NOMES_PERMITIDOS)) {
      await recusar('extensao', caminhoRelativo);
      return;
    }

    if (caminhoNegado(caminhoRelativo, negados)) {
      await recusar('denylist', caminhoRelativo);
      return;
    }

    const tamanho = await tamanhoDe(caminhoAbsoluto);

    if (tamanho === null) {
      await recusar('permissao', caminhoRelativo, 0);
      return;
    }

    if (tamanho === 0) {
      await recusar('vazio', caminhoRelativo, 0);
      return;
    }

    const cabeca = await lerCabeca(caminhoAbsoluto, tamanho);

    if (cabeca === null) {
      await recusar('permissao', caminhoRelativo, tamanho);
      return;
    }

    if (pareceBinario(cabeca)) {
      await recusar('binario', caminhoRelativo, tamanho);
      return;
    }

    aceitar(entrada.name, caminhoRelativo, tamanho);
  }

  const pendentes: string[] = [raizAbsoluta];

  while (pendentes.length > 0 && !truncada) {
    const diretorio = pendentes.pop() as string;

    let entradas: Dirent[];

    try {
      entradas = await readdir(diretorio, { withFileTypes: true });
    } catch {
      await recusar('permissao', relative(raizAbsoluta, diretorio) || '.', 0);
      continue;
    }

    entradas.sort((esquerda, direita) =>
      esquerda.name.localeCompare(direita.name),
    );

    for (const entrada of entradas) {
      const caminhoAbsoluto = join(diretorio, entrada.name);
      const caminhoRelativo = relative(raizAbsoluta, caminhoAbsoluto);

      if (entrada.isSymbolicLink()) {
        examinados += 1;
        await recusar('link_simbolico', caminhoRelativo, 0);
      } else if (entrada.isDirectory()) {
        if (!DIRETORIOS_IGNORADOS.includes(entrada.name)) {
          pendentes.push(caminhoAbsoluto);
        }

        continue;
      } else if (entrada.isFile()) {
        examinados += 1;
        await examinarArquivo(entrada, caminhoAbsoluto, caminhoRelativo);
      } else {
        continue;
      }

      if (examinados >= teto) {
        truncada = true;
        break;
      }
    }
  }

  const vagas =
    itensNaAmostra - Math.min(recusadosDaAmostra.length, RECUSADOS_NA_AMOSTRA);

  return {
    arquivosElegiveis,
    arquivosRecusados,
    bytesTotais,
    porExtensao,
    amostra: [...elegiveisDaAmostra.slice(0, vagas), ...recusadosDaAmostra],
    motivosDeRecusa,
    truncada,
  };
}
