import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import type { JwtModuleOptions } from '@nestjs/jwt';
import type { StringValue } from 'ms';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OraculoConfig } from '../config/config.service';
import { Perfil, PerfilCapacidade, Usuario } from '../database/entities';
import { AUTENTICADOR, Autenticador } from './autenticador';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { KeycloakAutenticador } from './keycloak.autenticador';
import { LocalAutenticador } from './local.autenticador';
import { OidcAutenticador } from './oidc.autenticador';
import { PerfilGuard } from './perfil.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Usuario, Perfil, PerfilCapacidade]),
    JwtModule.registerAsync({
      inject: [OraculoConfig],
      useFactory: (config: OraculoConfig): JwtModuleOptions => ({
        secret: config.auth.segredo,
        signOptions: { expiresIn: config.auth.ttl as StringValue },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    LocalAutenticador,
    KeycloakAutenticador,
    OidcAutenticador,
    AuthGuard,
    PerfilGuard,
    {
      provide: AUTENTICADOR,
      inject: [
        OraculoConfig,
        LocalAutenticador,
        KeycloakAutenticador,
        OidcAutenticador,
      ],
      useFactory: (
        config: OraculoConfig,
        local: LocalAutenticador,
        keycloak: KeycloakAutenticador,
        oidc: OidcAutenticador,
      ): Autenticador => {
        switch (config.auth.modo) {
          case 'local':
            return local;
          case 'keycloak':
            return keycloak;
          case 'oidc':
            return oidc;
        }
      },
    },
  ],
  exports: [AuthGuard, PerfilGuard, AUTENTICADOR],
})
export class AuthModule {}
