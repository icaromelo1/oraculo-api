import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { TAMANHO_MAXIMO_CONTEUDO } from './criar-nota.dto';

export class EditarNotaDto {
  @IsString({ message: 'conteudo precisa ser texto' })
  @IsNotEmpty({ message: 'conteudo é obrigatório' })
  @MaxLength(TAMANHO_MAXIMO_CONTEUDO, {
    message: 'conteudo passou do teto de 2 MB',
  })
  conteudo: string;
}
