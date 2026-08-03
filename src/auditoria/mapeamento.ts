import { Auditoria } from '../database/entities';
import type { BloqueioAuditado, ExecucaoAuditada } from '../security/tipos';
import type {
  CategoriaResultado,
  FerramentaAuditoria,
  RegistroAuditoria,
  TipoFerramentaAuditoria,
  TomResultado,
} from './tipos';

const TIPO_POR_CAPACIDADE: Record<string, TipoFerramentaAuditoria> = {
  buscar_conhecimento: 'doc',
  ler_documento: 'curado',
  buscar_codigo: 'codigo',
  ler_arquivo: 'codigo',
  consultar_banco: 'banco',
  estado_servicos: 'shell',
};

const SIGLA_POR_TIPO: Record<TipoFerramentaAuditoria, string> = {
  doc: 'doc',
  curado: 'cur',
  codigo: 'cod',
  banco: 'sql',
  inferencia: 'inf',
  shell: 'sh',
};

const TONS_DE_BLOQUEIO_DEDICADO = ['bloqueio', 'aprovacao_exigida'];

export const CATEGORIA_RESULTADO_SQL = `
  CASE
    WHEN auditoria.tom IN ('bloqueio', 'bloqueio_parcial') THEN 'bloqueado'
    WHEN auditoria.tom = 'aprovacao_exigida' THEN 'aprovado'
    WHEN auditoria.tom IN ('erro', 'limite') THEN 'erro'
    WHEN auditoria.tom = 'normal' AND auditoria.fontes = 0 THEN 'sem_resultado'
    ELSE 'ok'
  END
`;

export function ehRegistroDeTurno(tom: string): boolean {
  return !TONS_DE_BLOQUEIO_DEDICADO.includes(tom);
}

function listaExecucoes(auditoria: Auditoria): ExecucaoAuditada[] {
  const itens = (auditoria.ferramentas as { itens?: unknown } | null)?.itens;

  return Array.isArray(itens) ? (itens as ExecucaoAuditada[]) : [];
}

function listaBloqueios(auditoria: Auditoria): BloqueioAuditado[] {
  const itens = (auditoria.bloqueios as { itens?: unknown } | null)?.itens;

  return Array.isArray(itens) ? (itens as BloqueioAuditado[]) : [];
}

function somarRedacoes(execucoes: ExecucaoAuditada[]): number {
  return execucoes.reduce(
    (total, execucao) =>
      total +
      (execucao.redacoes?.reduce(
        (soma, ocorrencia) => soma + ocorrencia.quantidade,
        0,
      ) ?? 0),
    0,
  );
}

function paraFerramenta(
  nomeCapacidade: string,
  bloqueada: boolean,
): FerramentaAuditoria {
  const tipo = TIPO_POR_CAPACIDADE[nomeCapacidade] ?? 'inferencia';
  const sigla = SIGLA_POR_TIPO[tipo];

  return { sigla: bloqueada ? `${sigla}✕` : sigla, tipo, bloqueada };
}

export function montarFerramentas(auditoria: Auditoria): FerramentaAuditoria[] {
  const execucoes = listaExecucoes(auditoria);

  if (execucoes.length > 0) {
    return execucoes.map((execucao) =>
      paraFerramenta(execucao.nome, execucao.status === 'bloqueada'),
    );
  }

  return listaBloqueios(auditoria).map((bloqueio) =>
    paraFerramenta(bloqueio.capacidade, true),
  );
}

interface Categorizacao {
  categoria: CategoriaResultado;
  tomResultado: TomResultado;
  resultado: string;
}

export function categorizar(auditoria: Auditoria): Categorizacao {
  const primeiroBloqueio = listaBloqueios(auditoria)[0];

  if (auditoria.tom === 'bloqueio' || auditoria.tom === 'bloqueio_parcial') {
    return {
      categoria: 'bloqueado',
      tomResultado: 'erro',
      resultado: primeiroBloqueio
        ? `bloqueado · ${primeiroBloqueio.politica}`
        : 'bloqueado',
    };
  }

  if (auditoria.tom === 'aprovacao_exigida') {
    return {
      categoria: 'aprovado',
      tomResultado: 'aviso',
      resultado: primeiroBloqueio
        ? `aprovação pendente · ${primeiroBloqueio.politica}`
        : 'aprovação pendente',
    };
  }

  if (auditoria.tom === 'erro') {
    return {
      categoria: 'erro',
      tomResultado: 'erro',
      resultado: 'erro do modelo',
    };
  }

  if (auditoria.tom === 'limite') {
    return {
      categoria: 'erro',
      tomResultado: 'aviso',
      resultado: 'limite de execução atingido',
    };
  }

  if (auditoria.fontes === 0) {
    return {
      categoria: 'sem_resultado',
      tomResultado: 'neutro',
      resultado: 'sem resultado',
    };
  }

  const totalRedacoes = somarRedacoes(listaExecucoes(auditoria));

  if (totalRedacoes > 0) {
    const plural = totalRedacoes > 1 ? 's' : '';

    return {
      categoria: 'ok',
      tomResultado: 'aviso',
      resultado: `${totalRedacoes} trecho${plural} ocultado${plural}`,
    };
  }

  return { categoria: 'ok', tomResultado: 'ok', resultado: 'ok' };
}

export function formatarHora(data: Date): string {
  const preencher = (numero: number) => numero.toString().padStart(2, '0');

  return `${preencher(data.getHours())}:${preencher(data.getMinutes())}:${preencher(data.getSeconds())}`;
}

export function formatarDuracao(duracaoMs: number): string {
  const segundos = (duracaoMs / 1000).toFixed(1).replace('.', ',');

  return `${segundos} s`;
}

export function formatarInteiro(valor: number): string {
  return valor.toLocaleString('pt-BR').replace(/\./g, ' ');
}

function resumirArgumento(argumento?: Record<string, unknown> | null): string {
  if (!argumento || Object.keys(argumento).length === 0) return '';

  return ` ${JSON.stringify(argumento)}`;
}

function montarTrilha(auditoria: Auditoria): string[] {
  const passos: string[] = [];

  for (const execucao of listaExecucoes(auditoria)) {
    const duracao =
      execucao.duracaoMs !== undefined
        ? ` · ${formatarDuracao(execucao.duracaoMs)}`
        : '';
    const aprovacao = execucao.aprovadaPor
      ? ` · aprovado por ${execucao.aprovadaPor}`
      : '';

    passos.push(
      `${execucao.nome}${resumirArgumento(execucao.argumento)} · ${execucao.status}${duracao}${aprovacao}`,
    );
  }

  for (const bloqueio of listaBloqueios(auditoria)) {
    passos.push(
      `${bloqueio.capacidade} bloqueado · ${bloqueio.politica} · ${bloqueio.motivo}`,
    );
  }

  return passos;
}

function extrairSql(auditoria: Auditoria): {
  sqlExecutado?: string;
  notaSql?: string;
} {
  const execucaoBanco = listaExecucoes(auditoria).find(
    (execucao) => execucao.nome === 'consultar_banco',
  );
  const argumento = execucaoBanco?.argumento;
  const sql = argumento?.sql ?? argumento?.consulta;

  if (typeof sql !== 'string' || sql.trim().length === 0) {
    return {};
  }

  const redacoes =
    execucaoBanco?.redacoes?.reduce(
      (total, ocorrencia) => total + ocorrencia.quantidade,
      0,
    ) ?? 0;

  return {
    sqlExecutado: sql,
    notaSql:
      redacoes > 0
        ? `${redacoes} valor(es) redigido(s)`
        : 'sem valores redigidos',
  };
}

export function mapearRegistro(auditoria: Auditoria): RegistroAuditoria {
  const { tomResultado, resultado } = categorizar(auditoria);

  return {
    id: auditoria.id,
    hora: formatarHora(auditoria.criadaEm),
    usuario: auditoria.usuario?.login ?? '(sistema)',
    perfil: auditoria.usuario?.perfil?.nome ?? '—',
    pergunta: auditoria.pergunta,
    ferramentas: montarFerramentas(auditoria),
    fontes: auditoria.fontes,
    resultado,
    tomResultado,
    duracao: formatarDuracao(auditoria.duracaoMs),
    modelo: auditoria.modelo,
  };
}

export function mapearDetalhe(auditoria: Auditoria): RegistroAuditoria {
  const base = mapearRegistro(auditoria);
  const trilha = montarTrilha(auditoria);
  const { sqlExecutado, notaSql } = extrairSql(auditoria);

  return {
    ...base,
    ...(trilha.length > 0 ? { trilha } : {}),
    ...(sqlExecutado ? { sqlExecutado, notaSql } : {}),
  };
}
