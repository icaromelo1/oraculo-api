import { accessSync, constants, statSync } from 'node:fs';

export type NomeBinario = 'docker' | 'ss' | 'uptime' | 'free' | 'df' | 'nproc';

const CANDIDATOS_DE_BINARIO: Record<NomeBinario, readonly string[]> = {
  docker: [
    '/usr/bin/docker',
    '/usr/local/bin/docker',
    '/opt/homebrew/bin/docker',
  ],
  ss: ['/usr/sbin/ss', '/sbin/ss', '/usr/bin/ss'],
  uptime: ['/usr/bin/uptime', '/bin/uptime'],
  free: ['/usr/bin/free', '/bin/free'],
  df: ['/bin/df', '/usr/bin/df'],
  nproc: ['/usr/bin/nproc', '/bin/nproc'],
};

export type ResolvedorBinario = (nome: NomeBinario) => string | null;

export function candidatosDoBinario(nome: NomeBinario): readonly string[] {
  return CANDIDATOS_DE_BINARIO[nome] ?? [];
}

export const resolverBinario: ResolvedorBinario = (nome) => {
  for (const caminho of candidatosDoBinario(nome)) {
    try {
      if (!statSync(caminho).isFile()) {
        continue;
      }

      accessSync(caminho, constants.X_OK);

      return caminho;
    } catch {
      continue;
    }
  }

  return null;
};

export type NomeArgumento = 'servico' | 'linhas';

export interface EsquemaServico {
  readonly nome: 'servico';
  readonly tipo: 'servico_observavel';
  readonly descricao: string;
}

export interface EsquemaLinhas {
  readonly nome: 'linhas';
  readonly tipo: 'inteiro';
  readonly minimo: number;
  readonly maximo: number;
  readonly padrao: number;
  readonly descricao: string;
}

export type EsquemaArgumento = EsquemaServico | EsquemaLinhas;

export interface FatiaVariavel {
  readonly variavel: NomeArgumento;
}

export type PecaDeComando = string | FatiaVariavel;

export interface PassoDiagnostico {
  readonly id: string;
  readonly rotulo: string;
  readonly binario: NomeBinario;
  readonly pecas: readonly PecaDeComando[];
}

export interface EntradaCatalogo {
  readonly id: string;
  readonly descricao: string;
  readonly argumentos: readonly EsquemaArgumento[];
  readonly passos: readonly PassoDiagnostico[];
}

export const LINHAS_MINIMO = 1;
export const LINHAS_MAXIMO = 200;
export const LINHAS_PADRAO = 100;

const ESQUEMA_SERVICO: EsquemaServico = {
  nome: 'servico',
  tipo: 'servico_observavel',
  descricao:
    'nome de um serviço cadastrado e ativo em servico_observavel — qualquer outro nome é recusado',
};

const ESQUEMA_LINHAS: EsquemaLinhas = {
  nome: 'linhas',
  tipo: 'inteiro',
  minimo: LINHAS_MINIMO,
  maximo: LINHAS_MAXIMO,
  padrao: LINHAS_PADRAO,
  descricao: `quantas linhas do fim do log devolver (${LINHAS_MINIMO} a ${LINHAS_MAXIMO}, padrão ${LINHAS_PADRAO})`,
};

const FORMATO_CONTAINERES = [
  'servico={{.Names}}',
  'imagem={{.Image}}',
  'estado={{.Status}}',
  'de_pe_ha={{.RunningFor}}',
  'portas={{.Ports}}',
].join('\t');

const FORMATO_ESTADO = [
  'servico={{.Name}}',
  'estado={{.State.Status}}',
  'reinicios={{.RestartCount}}',
  'codigo_da_ultima_saida={{.State.ExitCode}}',
  'encerrado_por_falta_de_memoria={{.State.OOMKilled}}',
  'encerrado_em={{.State.FinishedAt}}',
  'saude={{if .State.Health}}{{.State.Health.Status}} apos {{.State.Health.FailingStreak}} falha(s) seguida(s){{else}}sem healthcheck{{end}}',
].join('\n');

const ENTRADAS: readonly EntradaCatalogo[] = [
  {
    id: 'servicos_ativos',
    descricao:
      'lista os serviços cadastrados que estão de pé, com imagem, estado, tempo de pé e as portas publicadas',
    argumentos: [],
    passos: [
      {
        id: 'containers',
        rotulo: 'containers de pé',
        binario: 'docker',
        pecas: ['ps', '--format', FORMATO_CONTAINERES],
      },
    ],
  },
  {
    id: 'servico_logs',
    descricao:
      'devolve as últimas linhas de log de um serviço cadastrado, com timestamp',
    argumentos: [ESQUEMA_SERVICO, ESQUEMA_LINHAS],
    passos: [
      {
        id: 'logs',
        rotulo: 'últimas linhas do log do serviço',
        binario: 'docker',
        pecas: [
          'logs',
          '--timestamps',
          '--tail',
          { variavel: 'linhas' },
          { variavel: 'servico' },
        ],
      },
    ],
  },
  {
    id: 'portas_escutando',
    descricao:
      'lista as portas TCP em escuta pelo próprio Oráculo (o endereço é mascarado, a porta não) — para as portas dos serviços da máquina, use servicos_ativos',
    argumentos: [],
    passos: [
      {
        id: 'escuta',
        rotulo: 'portas TCP em escuta',
        binario: 'ss',
        pecas: ['-l', '-t', '-n', '-p'],
      },
    ],
  },
  {
    id: 'recursos_maquina',
    descricao:
      'mostra uptime, load average, uso de memória, uso de disco e número de CPUs da máquina',
    argumentos: [],
    passos: [
      {
        id: 'uptime',
        rotulo: 'tempo de pé e load average',
        binario: 'uptime',
        pecas: [],
      },
      {
        id: 'memoria',
        rotulo: 'uso de memória em MB',
        binario: 'free',
        pecas: ['-m'],
      },
      {
        id: 'disco',
        rotulo: 'uso de disco',
        binario: 'df',
        pecas: ['-h'],
      },
      {
        id: 'cpus',
        rotulo: 'número de CPUs',
        binario: 'nproc',
        pecas: [],
      },
    ],
  },
  {
    id: 'estado_containers',
    descricao:
      'mostra reinícios, saúde, código da última saída e se houve encerramento por falta de memória de um serviço cadastrado',
    argumentos: [ESQUEMA_SERVICO],
    passos: [
      {
        id: 'inspecao',
        rotulo: 'estado do container',
        binario: 'docker',
        pecas: ['inspect', '--format', FORMATO_ESTADO, { variavel: 'servico' }],
      },
    ],
  },
];

const POR_ID = new Map<string, EntradaCatalogo>(
  ENTRADAS.map((entrada) => [entrada.id, entrada]),
);

export const CATALOGO_DIAGNOSTICO = ENTRADAS;

export const IDS_DO_CATALOGO: readonly string[] = ENTRADAS.map(
  (entrada) => entrada.id,
);

export function obterEntrada(id: unknown): EntradaCatalogo | undefined {
  if (typeof id !== 'string') {
    return undefined;
  }

  return POR_ID.get(id);
}

const NOME_DE_SERVICO = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/;

export function nomeDeServicoBemFormado(valor: unknown): valor is string {
  return typeof valor === 'string' && NOME_DE_SERVICO.test(valor);
}

export type LinhasNormalizadas =
  | { readonly ok: true; readonly valor: number }
  | { readonly ok: false; readonly motivo: string };

export function normalizarLinhas(
  bruto: unknown,
  esquema: EsquemaLinhas,
): LinhasNormalizadas {
  if (bruto === undefined || bruto === null) {
    return { ok: true, valor: esquema.padrao };
  }

  const numero =
    typeof bruto === 'number'
      ? bruto
      : typeof bruto === 'string' && bruto.trim().length > 0
        ? Number(bruto.trim())
        : Number.NaN;

  if (!Number.isInteger(numero)) {
    return {
      ok: false,
      motivo: `o argumento "linhas" precisa ser um número inteiro entre ${esquema.minimo} e ${esquema.maximo}`,
    };
  }

  return {
    ok: true,
    valor: Math.min(Math.max(numero, esquema.minimo), esquema.maximo),
  };
}

function pecaLegivel(peca: PecaDeComando): string {
  if (typeof peca !== 'string') {
    return `<${peca.variavel}>`;
  }

  return /[\s"']/.test(peca) ? JSON.stringify(peca) : peca;
}

export function descreverPasso(passo: PassoDiagnostico): string {
  return [passo.binario, ...passo.pecas.map(pecaLegivel)].join(' ');
}

export function descreverEntrada(entrada: EntradaCatalogo): string[] {
  return entrada.passos.map(descreverPasso);
}

export function montarArgumentos(
  passo: PassoDiagnostico,
  valores: Readonly<Partial<Record<NomeArgumento, string>>>,
): string[] | null {
  const argumentos: string[] = [];

  for (const peca of passo.pecas) {
    if (typeof peca === 'string') {
      argumentos.push(peca);
      continue;
    }

    const valor = valores[peca.variavel];

    if (typeof valor !== 'string' || valor.length === 0) {
      return null;
    }

    argumentos.push(valor);
  }

  return argumentos;
}
