import { SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import { PERFIS_EXIGIDOS_KEY, PerfilGuard } from './perfil.guard';

export const PERFIL_DONO = 'dono';

export const ExigePerfil = (...perfis: string[]) =>
  applyDecorators(
    SetMetadata(PERFIS_EXIGIDOS_KEY, perfis),
    UseGuards(PerfilGuard),
  );
