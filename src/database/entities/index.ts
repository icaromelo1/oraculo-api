import { Aprovacao } from './aprovacao.entity';
import { Auditoria } from './auditoria.entity';
import { Conversa } from './conversa.entity';
import { Documento } from './documento.entity';
import { FerramentaExecucao } from './ferramenta-execucao.entity';
import { Mensagem } from './mensagem.entity';
import { Perfil } from './perfil.entity';
import { PerfilCapacidade } from './perfil-capacidade.entity';
import { Trecho } from './trecho.entity';
import { Usuario } from './usuario.entity';

export { Aprovacao, StatusAprovacao } from './aprovacao.entity';
export { Auditoria } from './auditoria.entity';
export { Conversa } from './conversa.entity';
export { Documento } from './documento.entity';
export {
  FerramentaExecucao,
  StatusFerramentaExecucao,
} from './ferramenta-execucao.entity';
export { Mensagem, PapelMensagem } from './mensagem.entity';
export { Perfil } from './perfil.entity';
export {
  PerfilCapacidade,
  StatusPerfilCapacidade,
} from './perfil-capacidade.entity';
export { Trecho } from './trecho.entity';
export { Usuario } from './usuario.entity';

export const entidades = [
  Perfil,
  Usuario,
  PerfilCapacidade,
  Conversa,
  Mensagem,
  FerramentaExecucao,
  Documento,
  Trecho,
  Auditoria,
  Aprovacao,
];
