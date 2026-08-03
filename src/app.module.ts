import { Module } from '@nestjs/common';
import { AuditoriaModule } from './auditoria/auditoria.module';
import { AuthModule } from './auth/auth.module';
import { CapabilitiesModule } from './capabilities/capabilities.module';
import { ChatModule } from './chat/chat.module';
import { OraculoConfigModule } from './config/config.module';
import { CorpusModule } from './corpus/corpus.module';
import { EngineModule } from './engine/engine.module';
import { ProvidersModule } from './providers/providers.module';
import { SaudeModule } from './saude/saude.module';
import { SecurityModule } from './security/security.module';

@Module({
  imports: [
    OraculoConfigModule,
    SaudeModule,
    ProvidersModule,
    SecurityModule,
    AuthModule,
    CorpusModule,
    CapabilitiesModule,
    EngineModule,
    ChatModule,
    AuditoriaModule,
  ],
})
export class AppModule {}
