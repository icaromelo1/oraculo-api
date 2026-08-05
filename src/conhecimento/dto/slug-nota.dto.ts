import { IsString, Matches, MaxLength } from 'class-validator';
import { TAMANHO_MAXIMO_SLUG } from '../slug';

export class SlugNotaDto {
  @IsString({ message: 'slug precisa ser texto' })
  @MaxLength(TAMANHO_MAXIMO_SLUG, {
    message: `slug não pode passar de ${TAMANHO_MAXIMO_SLUG} caracteres`,
  })
  @Matches(/^[a-z0-9][a-z0-9-]*$/, {
    message:
      'slug inválido — só letras minúsculas, números e hífen, sem barra nem ".."',
  })
  slug: string;
}
