import { AlvoBanco } from './alvo-banco.entity';
import { Aprovacao } from './aprovacao.entity';
import { Auditoria } from './auditoria.entity';
import { CapacidadeInstalacao } from './capacidade-instalacao.entity';
import { Conversa } from './conversa.entity';
import { Documento } from './documento.entity';
import { FerramentaExecucao } from './ferramenta-execucao.entity';
import { FonteConhecimento } from './fonte-conhecimento.entity';
import { Mensagem } from './mensagem.entity';
import { Modulo } from './modulo.entity';
import { Perfil } from './perfil.entity';
import { PerfilCapacidade } from './perfil-capacidade.entity';
import { Persona } from './persona.entity';
import { PropostaConhecimento } from './proposta-conhecimento.entity';
import { ProvedorModelo } from './provedor-modelo.entity';
import { ServicoObservavel } from './servico-observavel.entity';
import { Trecho } from './trecho.entity';
import { Usuario } from './usuario.entity';

export { AlvoBanco } from './alvo-banco.entity';
export { Aprovacao, StatusAprovacao } from './aprovacao.entity';
export { Auditoria } from './auditoria.entity';
export {
  CapacidadeInstalacao,
  NomeCapacidadeInstalacao,
} from './capacidade-instalacao.entity';
export { Conversa } from './conversa.entity';
export { Documento } from './documento.entity';
export {
  FerramentaExecucao,
  StatusFerramentaExecucao,
} from './ferramenta-execucao.entity';
export { FonteConhecimento } from './fonte-conhecimento.entity';
export { Mensagem, PapelMensagem } from './mensagem.entity';
export { Modulo } from './modulo.entity';
export { Perfil } from './perfil.entity';
export {
  PerfilCapacidade,
  StatusPerfilCapacidade,
} from './perfil-capacidade.entity';
export { Persona } from './persona.entity';
export {
  PropostaConhecimento,
  StatusProposta,
} from './proposta-conhecimento.entity';
export { ProvedorModelo, TipoProvedorModelo } from './provedor-modelo.entity';
export { ServicoObservavel } from './servico-observavel.entity';
export { Trecho } from './trecho.entity';
export { Usuario } from './usuario.entity';

export const entidades = [
  Perfil,
  Usuario,
  PerfilCapacidade,
  Conversa,
  Mensagem,
  FerramentaExecucao,
  Modulo,
  Documento,
  Trecho,
  Auditoria,
  Aprovacao,
  CapacidadeInstalacao,
  FonteConhecimento,
  AlvoBanco,
  ServicoObservavel,
  ProvedorModelo,
  PropostaConhecimento,
  Persona,
];
