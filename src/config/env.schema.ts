import { z } from 'zod';

const separarLista = (valor: string) =>
  valor
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const lista = (padrao = '') =>
  z.string().default(padrao).transform(separarLista);

const opcional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (valor) => (valor === '' ? undefined : valor),
    schema.optional(),
  );

const capacidade = (padrao: 'on' | 'off') =>
  z
    .enum(['on', 'off'])
    .default(padrao)
    .transform((valor) => valor === 'on');

export const NEGADOS_PADRAO = [
  'secrets*',
  '.env*',
  '*.key',
  '*.pem',
  '*.p12',
  'id_rsa*',
  '*token*',
  '*.sqlite',
  'dsg-workspace',
  'cast-workspace',
].join(',');

export const TIPOS_DE_PROVEDOR = ['cli', 'anthropic', 'openai-compat'] as const;

export type TipoDeProvedor = (typeof TIPOS_DE_PROVEDOR)[number];

export const PROVEDORES_PADRAO = 'openai-compat,cli,anthropic';

const listaDeProvedores = () =>
  lista(PROVEDORES_PADRAO).pipe(
    z.array(z.enum(TIPOS_DE_PROVEDOR)).min(1, {
      message: `PROVEDORES_PERMITIDOS precisa listar ao menos um de ${TIPOS_DE_PROVEDOR.join(', ')}`,
    }),
  );

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),

  MODEL_PROVIDER: z.enum(TIPOS_DE_PROVEDOR).default('cli'),
  PROVEDORES_PERMITIDOS: listaDeProvedores(),
  // Trava o provedor nesta instalação: a tela passa a mostrar sem deixar alterar.
  // Ausente ou 'false', o cadastro pela tela funciona normalmente — é o que permite
  // a quem clonar o Oráculo configurar do próprio jeito.
  PROVEDOR_TRAVADO: z
    .enum(['true', 'false'])
    .default('false')
    .transform((valor) => valor === 'true'),
  CLI_COMANDO: z.string().default('claude -p --output-format stream-json'),
  CLI_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  CLI_DIALETO: z.enum(['auto', 'claude', 'agy']).default('auto'),
  CLI_MODELO: opcional(z.string()),
  ANTHROPIC_API_KEY: opcional(z.string()),
  ANTHROPIC_MODELO: z.string().default('claude-haiku-4-5-20251001'),
  OPENAI_BASE_URL: opcional(z.string().url()),
  OPENAI_API_KEY: opcional(z.string()),
  OPENAI_MODELO: opcional(z.string()),

  RETRIEVAL_MODE: z.enum(['hibrido', 'lexical', 'vetorial']).default('hibrido'),
  EMBEDDING_MODELO: z.string().default('Xenova/multilingual-e5-small'),
  EMBEDDING_DIMENSOES: z.coerce.number().int().positive().default(384),

  CORPUS_FONTES: lista(),
  CORPUS_NEGADOS: lista(NEGADOS_PADRAO),
  CAMINHO_EXIBICAO: lista(),
  DIRETORIO_NOTAS: z.string().min(1).default('/corpus/notas'),

  CAP_CONHECIMENTO: capacidade('on'),
  CAP_CODIGO: capacidade('on'),
  CAP_ESTADO: capacidade('off'),
  CAP_BANCO: capacidade('off'),

  CODIGO_REPOS: lista(),
  ESTADO_COMANDOS: lista(),
  BANCO_ALVOS: lista(),

  AUTH_MODE: z.enum(['local', 'keycloak', 'oidc']).default('local'),
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET precisa de ao menos 32 caracteres'),
  JWT_TTL: z.string().default('12h'),

  CONFIG_SECRET: opcional(
    z.string().min(32, 'CONFIG_SECRET precisa de ao menos 32 caracteres'),
  ),

  ENGINE_MAX_ITERACOES: z.coerce.number().int().positive().default(8),
  ENGINE_MAX_TOKENS_SAIDA: z.coerce.number().int().positive().default(4000),

  GITHUB_TOKEN: opcional(z.string()),
  GITHUB_USUARIO: z.string().default('icaroMelo1'),
  USUARIO_DONO: z.string().default('ubuntu'),
});

export type Env = z.infer<typeof envSchema>;

export function validarEnv(bruto: Record<string, unknown>): Env {
  const resultado = envSchema.safeParse(bruto);

  if (!resultado.success) {
    const problemas = resultado.error.issues
      .map(
        (issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`,
      )
      .join('\n');

    throw new Error(
      `Configuração inválida — o Oráculo não sobe assim:\n${problemas}`,
    );
  }

  const env = resultado.data;

  if (!env.PROVEDORES_PERMITIDOS.includes(env.MODEL_PROVIDER)) {
    throw new Error(
      `MODEL_PROVIDER=${env.MODEL_PROVIDER} está fora de PROVEDORES_PERMITIDOS (${env.PROVEDORES_PERMITIDOS.join(', ')}) — o provedor do .env é o piso desta instalação e precisa estar na lista`,
    );
  }

  if (env.MODEL_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
    throw new Error('MODEL_PROVIDER=anthropic exige ANTHROPIC_API_KEY');
  }

  if (
    env.MODEL_PROVIDER === 'openai-compat' &&
    (!env.OPENAI_BASE_URL || !env.OPENAI_MODELO)
  ) {
    throw new Error(
      'MODEL_PROVIDER=openai-compat exige OPENAI_BASE_URL e OPENAI_MODELO',
    );
  }

  if (env.CAP_CODIGO && env.CODIGO_REPOS.length === 0) {
    throw new Error('CAP_CODIGO=on exige CODIGO_REPOS com ao menos um caminho');
  }

  if (env.CAP_ESTADO && env.ESTADO_COMANDOS.length === 0) {
    throw new Error(
      'CAP_ESTADO=on exige ESTADO_COMANDOS (allowlist, nunca shell livre)',
    );
  }

  if (env.CAP_BANCO && env.BANCO_ALVOS.length === 0) {
    throw new Error('CAP_BANCO=on exige BANCO_ALVOS');
  }

  return env;
}
