export { SecurityModule } from './security.module';
export { SecurityService } from './security.service';
export { EnvelopeService } from './envelope.service';
export { RedactionService } from './redaction.service';
export { PoliticaService } from './politica.service';
export { AuditoriaRegistroService } from './auditoria-registro.service';
export { SanitizadorDiagnostico } from './sanitizador-diagnostico';
export type { ResultadoSanitizacao } from './sanitizador-diagnostico';
export type {
  AlcancePerfil,
  BloqueioAuditado,
  CapacidadeDoPerfil,
  Decisao,
  EntradaEnvelope,
  ExecucaoAuditada,
  OcorrenciaRedacao,
  OrigemConteudo,
  PedidoFerramenta,
  Politica,
  RegistroBloqueio,
  RegistroTurno,
  ResultadoRedacao,
  RetornoFerramenta,
  RetornoProtegido,
  TipoSegredo,
  Veredito,
} from './tipos';
