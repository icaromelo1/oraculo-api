import { Injectable, Optional } from '@nestjs/common';
import fg from 'fast-glob';
import { relative, resolve } from 'node:path';
import { OraculoConfig } from '../config/config.service';
import { ConfiguracaoService } from '../config/configuracao.service';
import { caminhoNegado } from './denylist';

const PADROES_PERMITIDOS = [
  '**/*.md',
  '**/*.yml',
  '**/*.yaml',
  '**/*.conf',
  '**/*.json',
  '**/*.ts',
  '**/*.js',
  '**/*.sh',
  '**/Dockerfile',
  '**/Dockerfile.*',
  '**/docker-compose*.yml',
  '**/docker-compose*.yaml',
];

const IGNORADOS_SEMPRE = ['**/node_modules/**', '**/.git/**', '**/dist/**'];

export interface ArquivoEncontrado {
  caminhoAbsoluto: string;
}

export interface ResultadoVarredura {
  arquivos: ArquivoEncontrado[];
  recusadosPelaDenylist: number;
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

    return varrerFontes(caminhos, this.config.corpus.negados);
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
