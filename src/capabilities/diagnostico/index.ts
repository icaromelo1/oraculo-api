export {
  CATALOGO_DIAGNOSTICO,
  IDS_DO_CATALOGO,
  descreverEntrada,
  descreverPasso,
  montarArgumentos,
  nomeDeServicoBemFormado,
  normalizarLinhas,
  obterEntrada,
  resolverBinario,
} from './catalogo';
export type {
  EntradaCatalogo,
  EsquemaArgumento,
  NomeArgumento,
  NomeBinario,
  PassoDiagnostico,
  ResolvedorBinario,
} from './catalogo';
export {
  ExecutorDiagnostico,
  RESOLVEDOR_BINARIO,
  TETO_DE_SAIDA_BYTES,
  TIMEOUT_DIAGNOSTICO_MS,
} from './executor.service';
export type { ResultadoExecucao } from './executor.service';
export { DiagnosticoCapacidade } from './diagnostico.capacidade';
export type {
  ArgumentoDoCatalogo,
  CatalogoExibido,
  EntradaDoCatalogoExibida,
} from './diagnostico.capacidade';
