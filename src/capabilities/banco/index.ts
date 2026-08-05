export {
  ABRIDOR_DE_SESSAO,
  abrirSessaoPostgres,
  TIMEOUT_CONEXAO_MS,
  TIMEOUT_CONSULTA_MS,
} from './conexao';
export type {
  AbridorDeSessao,
  OpcoesSessao,
  RespostaConsulta,
  SessaoBanco,
} from './conexao';
export {
  formatarSchema,
  formatarTabela,
  indicesMascarados,
  MASCARA,
  TAMANHO_MAXIMO_SAIDA,
  TAMANHO_MAXIMO_VALOR,
  textoDoValor,
} from './apresentacao';
export type { ColunaDoSchema, TabelaFormatada } from './apresentacao';
export {
  schemasBemFormados,
  TAMANHO_MAXIMO_SQL,
  TETO_DE_LINHAS_PADRAO,
  tokenizar,
  validarConsulta,
} from './sql-seguro';
export type {
  ConsultaAprovada,
  ConsultaRecusada,
  OpcoesValidacao,
  Token,
  Tokenizacao,
  VeredictoConsulta,
} from './sql-seguro';
export {
  ExecutorConsulta,
  TETO_DE_COLUNAS_DO_SCHEMA,
} from './executor-consulta.service';
export type {
  EntradaConsulta,
  EntradaDescricao,
  ResultadoConsulta,
  ResultadoDescricao,
} from './executor-consulta.service';
export {
  ConsultarBancoCapacidade,
  OPERACOES,
} from './consultar-banco.capacidade';
export type { Operacao } from './consultar-banco.capacidade';
