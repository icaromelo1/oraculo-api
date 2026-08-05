import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

const TAMANHO_MAXIMO_TITULO = 200;
export const TAMANHO_MAXIMO_CONTEUDO = 2 * 1024 * 1024;

const aparar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CriarNotaDto {
  @IsString({ message: 'titulo precisa ser texto' })
  @IsNotEmpty({ message: 'titulo é obrigatório' })
  @MaxLength(TAMANHO_MAXIMO_TITULO, {
    message: `titulo não pode passar de ${TAMANHO_MAXIMO_TITULO} caracteres`,
  })
  @Transform(aparar)
  titulo: string;

  @IsString({ message: 'conteudo precisa ser texto' })
  @IsNotEmpty({ message: 'conteudo é obrigatório' })
  @MaxLength(TAMANHO_MAXIMO_CONTEUDO, {
    message: 'conteudo passou do teto de 2 MB',
  })
  conteudo: string;
}
