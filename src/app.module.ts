import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AmbienteModule } from './ambiente/ambiente.module';
import { ConhecimentoModule } from './conhecimento/conhecimento.module';
import { AuditoriaModule } from './auditoria/auditoria.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';
import { CapabilitiesModule } from './capabilities/capabilities.module';
import { ChatModule } from './chat/chat.module';
import { OraculoConfigModule } from './config/config.module';
import { CorpusModule } from './corpus/corpus.module';
import { DatabaseModule } from './database/database.module';
import { EngineModule } from './engine/engine.module';
import { PropostasModule } from './propostas/propostas.module';
import { ProvidersModule } from './providers/providers.module';
import { SaudeModule } from './saude/saude.module';
import { SecurityModule } from './security/security.module';

@Module({
  imports: [
    OraculoConfigModule,
    DatabaseModule,
    SaudeModule,
    ProvidersModule,
    SecurityModule,
    AuthModule,
    CorpusModule,
    CapabilitiesModule,
    EngineModule,
    ChatModule,
    AuditoriaModule,
    AmbienteModule,
    ConhecimentoModule,
    PropostasModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
