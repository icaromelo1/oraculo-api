export const TETO_DE_LINHAS_PADRAO = 100;
export const TAMANHO_MAXIMO_SQL = 8000;

export type TipoToken = 'palavra' | 'numero' | 'texto' | 'citado' | 'simbolo';

export interface Token {
  readonly tipo: TipoToken;
  readonly valor: string;
  readonly baixa: string;
  readonly inicio: number;
  readonly fim: number;
}

export type Tokenizacao =
  | { readonly ok: true; readonly tokens: Token[] }
  | { readonly ok: false; readonly motivo: string };

const SIMBOLOS = new Set([
  '(',
  ')',
  ',',
  '.',
  '*',
  '+',
  '-',
  '/',
  '%',
  '<',
  '>',
  '=',
  '!',
  '|',
  ':',
  '[',
  ']',
]);

const PALAVRAS_NEGADAS = new Set([
  'insert',
  'update',
  'delete',
  'drop',
  'alter',
  'create',
  'truncate',
  'grant',
  'revoke',
  'copy',
  'merge',
  'into',
  'reindex',
  'refresh',
  'vacuum',
  'call',
  'lock',
  'prepare',
  'execute',
  'deallocate',
  'declare',
  'fetch',
  'do',
  'set',
  'reset',
  'listen',
  'unlisten',
  'notify',
  'discard',
  'analyze',
  'analyse',
  'cluster',
  'checkpoint',
  'begin',
  'commit',
  'rollback',
  'savepoint',
  'import',
  'attach',
  'detach',
  'returning',
  'explain',
  'current_user',
  'session_user',
  'current_database',
  'current_catalog',
  'current_schema',
  'current_query',
  'dblink',
  'dblink_connect',
  'dblink_connect_u',
  'dblink_exec',
  'dblink_send_query',
  'lo_import',
  'lo_export',
  'lo_get',
  'lo_put',
  'lo_from_bytea',
  'lo_unlink',
  'query_to_xml',
  'query_to_xmlschema',
  'xmltable',
  'xmlparse',
  'xpath',
  'current_setting',
  'set_config',
  'postgres_fdw',
  'file_fdw',
]);

const PALAVRAS_ESTRUTURAIS = new Set([
  'select',
  'from',
  'where',
  'and',
  'or',
  'not',
  'in',
  'exists',
  'any',
  'all',
  'some',
  'on',
  'using',
  'as',
  'by',
  'group',
  'order',
  'having',
  'when',
  'then',
  'else',
  'case',
  'join',
  'lateral',
  'union',
  'intersect',
  'except',
  'over',
  'partition',
  'filter',
  'distinct',
  'array',
  'row',
  'values',
  'limit',
  'offset',
  'is',
  'cross',
  'inner',
  'outer',
  'natural',
]);

const FUNCOES_PERMITIDAS = new Set([
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'coalesce',
  'nullif',
  'greatest',
  'least',
  'length',
  'char_length',
  'character_length',
  'octet_length',
  'upper',
  'lower',
  'initcap',
  'trim',
  'btrim',
  'ltrim',
  'rtrim',
  'lpad',
  'rpad',
  'substr',
  'substring',
  'replace',
  'translate',
  'split_part',
  'strpos',
  'position',
  'overlay',
  'concat',
  'concat_ws',
  'left',
  'right',
  'repeat',
  'reverse',
  'md5',
  'encode',
  'to_char',
  'to_date',
  'to_timestamp',
  'to_number',
  'date_trunc',
  'date_part',
  'extract',
  'age',
  'now',
  'make_date',
  'make_time',
  'abs',
  'ceil',
  'ceiling',
  'floor',
  'round',
  'trunc',
  'mod',
  'power',
  'sqrt',
  'exp',
  'ln',
  'log',
  'sign',
  'div',
  'cast',
  'array_agg',
  'array_length',
  'array_to_string',
  'cardinality',
  'unnest',
  'string_agg',
  'json_agg',
  'jsonb_agg',
  'json_build_object',
  'jsonb_build_object',
  'json_array_length',
  'jsonb_array_length',
  'json_typeof',
  'jsonb_typeof',
  'row_number',
  'rank',
  'dense_rank',
  'percent_rank',
  'ntile',
  'lag',
  'lead',
  'first_value',
  'last_value',
  'nth_value',
  'stddev',
  'stddev_pop',
  'stddev_samp',
  'variance',
  'var_pop',
  'var_samp',
  'percentile_cont',
  'percentile_disc',
  'mode',
  'bool_and',
  'bool_or',
  'every',
]);

const NOME_DE_SCHEMA = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

export interface OpcoesValidacao {
  readonly teto: number;
  readonly schemas: readonly string[];
  readonly colunasMascaradas?: readonly string[];
}

export interface ConsultaAprovada {
  readonly ok: true;
  readonly sql: string;
  readonly limite: number;
  readonly limiteImposto: boolean;
  readonly schemasCitados: string[];
}

export interface ConsultaRecusada {
  readonly ok: false;
  readonly motivo: string;
}

export type VeredictoConsulta = ConsultaAprovada | ConsultaRecusada;

function ehLetraInicial(caractere: string): boolean {
  return /[A-Za-z_]/.test(caractere);
}

function ehLetraDeNome(caractere: string): boolean {
  return /[A-Za-z0-9_]/.test(caractere);
}

function ehDigito(caractere: string): boolean {
  return caractere >= '0' && caractere <= '9';
}

function recusar(motivo: string): ConsultaRecusada {
  return { ok: false, motivo };
}

function lerTexto(sql: string, inicio: number): number | null {
  let i = inicio + 1;

  while (i < sql.length) {
    if (sql[i] !== "'") {
      i += 1;
      continue;
    }

    if (sql[i + 1] === "'") {
      i += 2;
      continue;
    }

    return i + 1;
  }

  return null;
}

function lerCitado(sql: string, inicio: number): number | null {
  let i = inicio + 1;

  while (i < sql.length) {
    if (sql[i] !== '"') {
      i += 1;
      continue;
    }

    if (sql[i + 1] === '"') {
      i += 2;
      continue;
    }

    return i + 1;
  }

  return null;
}

function lerNumero(sql: string, inicio: number): number {
  let i = inicio;

  while (i < sql.length && ehDigito(sql[i])) {
    i += 1;
  }

  if (sql[i] === '.' && ehDigito(sql[i + 1] ?? '')) {
    i += 1;

    while (i < sql.length && ehDigito(sql[i])) {
      i += 1;
    }
  }

  const expoente = sql[i];

  if (expoente === 'e' || expoente === 'E') {
    const sinal = sql[i + 1] === '+' || sql[i + 1] === '-' ? 1 : 0;

    if (ehDigito(sql[i + 1 + sinal] ?? '')) {
      i += 1 + sinal;

      while (i < sql.length && ehDigito(sql[i])) {
        i += 1;
      }
    }
  }

  return i;
}

export function tokenizar(sql: string): Tokenizacao {
  const tokens: Token[] = [];
  let i = 0;

  while (i < sql.length) {
    const caractere = sql[i];

    if (/\s/.test(caractere)) {
      i += 1;
      continue;
    }

    if (caractere === '-' && sql[i + 1] === '-') {
      return { ok: false, motivo: 'comentário "--" não é aceito na consulta' };
    }

    if (caractere === '/' && sql[i + 1] === '*') {
      return {
        ok: false,
        motivo: 'comentário "/* */" não é aceito na consulta',
      };
    }

    if (caractere === ';') {
      return {
        ok: false,
        motivo: 'ponto e vírgula não é aceito — só uma instrução por consulta',
      };
    }

    if (caractere === "'") {
      const fim = lerTexto(sql, i);

      if (fim === null) {
        return { ok: false, motivo: 'literal de texto sem aspa de fechamento' };
      }

      tokens.push({
        tipo: 'texto',
        valor: sql.slice(i, fim),
        baixa: sql.slice(i, fim).toLowerCase(),
        inicio: i,
        fim,
      });
      i = fim;
      continue;
    }

    if (caractere === '"') {
      const fim = lerCitado(sql, i);

      if (fim === null) {
        return {
          ok: false,
          motivo: 'identificador entre aspas duplas sem fechamento',
        };
      }

      const miolo = sql.slice(i + 1, fim - 1).replace(/""/g, '"');

      tokens.push({
        tipo: 'citado',
        valor: miolo,
        baixa: miolo.toLowerCase(),
        inicio: i,
        fim,
      });
      i = fim;
      continue;
    }

    if (ehLetraInicial(caractere)) {
      let fim = i;

      while (fim < sql.length && ehLetraDeNome(sql[fim])) {
        fim += 1;
      }

      if (sql[fim] === "'") {
        return {
          ok: false,
          motivo:
            "literal com prefixo (E'', U&'', B'', X'') não é aceito na consulta",
        };
      }

      const valor = sql.slice(i, fim);

      tokens.push({
        tipo: 'palavra',
        valor,
        baixa: valor.toLowerCase(),
        inicio: i,
        fim,
      });
      i = fim;
      continue;
    }

    if (ehDigito(caractere)) {
      const fim = lerNumero(sql, i);
      const valor = sql.slice(i, fim);

      tokens.push({
        tipo: 'numero',
        valor,
        baixa: valor.toLowerCase(),
        inicio: i,
        fim,
      });
      i = fim;
      continue;
    }

    if (SIMBOLOS.has(caractere)) {
      tokens.push({
        tipo: 'simbolo',
        valor: caractere,
        baixa: caractere,
        inicio: i,
        fim: i + 1,
      });
      i += 1;
      continue;
    }

    return {
      ok: false,
      motivo: `caractere "${caractere}" não é aceito fora de um literal de texto`,
    };
  }

  return { ok: true, tokens };
}

function ehNome(token: Token | undefined): token is Token {
  return (
    token !== undefined && (token.tipo === 'palavra' || token.tipo === 'citado')
  );
}

function ehSimbolo(token: Token | undefined, valor: string): boolean {
  return (
    token !== undefined && token.tipo === 'simbolo' && token.valor === valor
  );
}

function conferirPalavrasNegadas(tokens: Token[]): string | null {
  for (const token of tokens) {
    if (!ehNome(token)) {
      continue;
    }

    if (token.baixa.startsWith('pg_')) {
      return `"${token.valor}" toca o catálogo interno do Postgres e nunca é aceito`;
    }

    if (PALAVRAS_NEGADAS.has(token.baixa)) {
      return `"${token.valor}" não é aceito — o Oráculo só executa leitura, numa única instrução`;
    }
  }

  return null;
}

function conferirFuncoes(tokens: Token[]): string | null {
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];

    if (!ehNome(token) || !ehSimbolo(tokens[i + 1], '(')) {
      continue;
    }

    if (ehSimbolo(tokens[i - 1], '.')) {
      return `"${token.valor}" é uma função qualificada por schema e não está na allowlist do Oráculo`;
    }

    if (
      FUNCOES_PERMITIDAS.has(token.baixa) ||
      (token.tipo === 'palavra' && PALAVRAS_ESTRUTURAIS.has(token.baixa))
    ) {
      continue;
    }

    return `a função "${token.valor}" não está na allowlist do Oráculo`;
  }

  return null;
}

interface Referencia {
  readonly schema: Token | null;
  readonly nome: Token;
}

function referenciasDeTabela(
  tokens: Token[],
): { ok: true; referencias: Referencia[] } | { ok: false; motivo: string } {
  const referencias: Referencia[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];

    if (token.tipo !== 'palavra') {
      continue;
    }

    if (token.baixa !== 'from' && token.baixa !== 'join') {
      continue;
    }

    let j = i + 1;

    while (
      tokens[j]?.tipo === 'palavra' &&
      (tokens[j].baixa === 'only' || tokens[j].baixa === 'lateral')
    ) {
      j += 1;
    }

    if (!ehNome(tokens[j])) {
      continue;
    }

    const partes: Token[] = [tokens[j]];

    while (ehSimbolo(tokens[j + 1], '.') && ehNome(tokens[j + 2])) {
      partes.push(tokens[j + 2]);
      j += 2;
    }

    if (ehSimbolo(tokens[j + 1], '(')) {
      continue;
    }

    if (partes.length > 2) {
      return {
        ok: false,
        motivo: `"${partes.map((parte) => parte.valor).join('.')}" tem mais de um nível de qualificação e não é aceito`,
      };
    }

    referencias.push(
      partes.length === 2
        ? { schema: partes[0], nome: partes[1] }
        : { schema: null, nome: partes[0] },
    );
  }

  return { ok: true, referencias };
}

function conferirSchemas(
  referencias: Referencia[],
  permitidos: readonly string[],
): { ok: true; citados: string[] } | { ok: false; motivo: string } {
  const emBaixa = new Set(permitidos.map((schema) => schema.toLowerCase()));
  const exatos = new Set(permitidos);
  const citados = new Set<string>();

  for (const referencia of referencias) {
    if (!referencia.schema) {
      continue;
    }

    const aceito =
      referencia.schema.tipo === 'citado'
        ? exatos.has(referencia.schema.valor)
        : emBaixa.has(referencia.schema.baixa);

    if (!aceito) {
      return {
        ok: false,
        motivo: `o schema "${referencia.schema.valor}" não está liberado para este alvo — os liberados são ${permitidos.join(', ')}`,
      };
    }

    citados.add(referencia.schema.valor);
  }

  return { ok: true, citados: [...citados] };
}

function colunasMascaradasCitadas(
  tokens: Token[],
  mascaradas: readonly string[],
): string[] {
  const procuradas = new Set(
    mascaradas.map((coluna) => coluna.trim().toLowerCase()).filter(Boolean),
  );

  if (procuradas.size === 0) {
    return [];
  }

  const encontradas = new Set<string>();

  for (const token of tokens) {
    if (ehNome(token) && procuradas.has(token.baixa)) {
      encontradas.add(token.baixa);
    }
  }

  return [...encontradas];
}

function indiceDoLimite(tokens: Token[]): number {
  let profundidade = 0;
  let encontrado = -1;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];

    if (token.tipo === 'simbolo' && token.valor === '(') {
      profundidade += 1;
      continue;
    }

    if (token.tipo === 'simbolo' && token.valor === ')') {
      profundidade -= 1;
      continue;
    }

    if (
      profundidade === 0 &&
      token.tipo === 'palavra' &&
      token.baixa === 'limit'
    ) {
      encontrado = i;
    }
  }

  return encontrado;
}

interface LimiteAplicado {
  readonly sql: string;
  readonly limite: number;
  readonly imposto: boolean;
}

function aplicarLimite(
  sql: string,
  tokens: Token[],
  teto: number,
): LimiteAplicado | ConsultaRecusada {
  const indice = indiceDoLimite(tokens);

  if (indice === -1) {
    return { sql: `${sql} LIMIT ${teto}`, limite: teto, imposto: true };
  }

  const alvo = tokens[indice + 1];

  if (!alvo || alvo.tipo !== 'numero' || !/^\d+$/.test(alvo.valor)) {
    return recusar(
      'o LIMIT precisa vir seguido de um número inteiro — LIMIT ALL, expressão ou parâmetro não é aceito',
    );
  }

  const pedido = Number(alvo.valor);

  if (pedido <= teto) {
    return { sql, limite: pedido, imposto: false };
  }

  return {
    sql: `${sql.slice(0, alvo.inicio)}${teto}${sql.slice(alvo.fim)}`,
    limite: teto,
    imposto: true,
  };
}

export function schemasBemFormados(
  schemas: readonly string[],
): { ok: true; schemas: string[] } | { ok: false; motivo: string } {
  const limpos = schemas.map((schema) => schema.trim()).filter(Boolean);

  if (limpos.length === 0) {
    return {
      ok: false,
      motivo:
        'o alvo não declara nenhum schema — sem schema declarado o Oráculo não consulta nada',
    };
  }

  const invalido = limpos.find((schema) => !NOME_DE_SCHEMA.test(schema));

  if (invalido) {
    return {
      ok: false,
      motivo: `o schema "${invalido}" cadastrado para este alvo está fora do formato aceito`,
    };
  }

  return { ok: true, schemas: limpos };
}

export function validarConsulta(
  bruto: unknown,
  opcoes: OpcoesValidacao,
): VeredictoConsulta {
  if (typeof bruto !== 'string' || !bruto.trim()) {
    return recusar('o argumento "sql" é obrigatório e precisa ser texto');
  }

  if (bruto.length > TAMANHO_MAXIMO_SQL) {
    return recusar(
      `a consulta passa de ${TAMANHO_MAXIMO_SQL} caracteres e não é aceita`,
    );
  }

  const schemas = schemasBemFormados(opcoes.schemas);

  if (!schemas.ok) {
    return recusar(schemas.motivo);
  }

  const semPontoFinal = bruto.trim().replace(/;$/, '').trim();

  if (!semPontoFinal) {
    return recusar('o argumento "sql" é obrigatório e precisa ser texto');
  }

  const tokenizacao = tokenizar(semPontoFinal);

  if (!tokenizacao.ok) {
    return recusar(tokenizacao.motivo);
  }

  const { tokens } = tokenizacao;
  const primeiro = tokens[0];

  if (
    !primeiro ||
    primeiro.tipo !== 'palavra' ||
    (primeiro.baixa !== 'select' && primeiro.baixa !== 'with')
  ) {
    return recusar(
      'a consulta precisa começar com SELECT ou WITH — nenhuma outra instrução é executada',
    );
  }

  const negada = conferirPalavrasNegadas(tokens);

  if (negada) {
    return recusar(negada);
  }

  const funcao = conferirFuncoes(tokens);

  if (funcao) {
    return recusar(funcao);
  }

  const mascaradas = colunasMascaradasCitadas(
    tokens,
    opcoes.colunasMascaradas ?? [],
  );

  if (mascaradas.length > 0) {
    return recusar(
      `a consulta nomeia a(s) coluna(s) mascarada(s) ${mascaradas.join(', ')} — use "*" e o Oráculo devolve o valor já mascarado`,
    );
  }

  const referencias = referenciasDeTabela(tokens);

  if (!referencias.ok) {
    return recusar(referencias.motivo);
  }

  const conferencia = conferirSchemas(referencias.referencias, schemas.schemas);

  if (!conferencia.ok) {
    return recusar(conferencia.motivo);
  }

  const teto =
    Number.isInteger(opcoes.teto) && opcoes.teto > 0
      ? opcoes.teto
      : TETO_DE_LINHAS_PADRAO;

  const limitada = aplicarLimite(semPontoFinal, tokens, teto);

  if ('ok' in limitada) {
    return limitada;
  }

  return {
    ok: true,
    sql: limitada.sql,
    limite: limitada.limite,
    limiteImposto: limitada.imposto,
    schemasCitados: conferencia.citados,
  };
}
