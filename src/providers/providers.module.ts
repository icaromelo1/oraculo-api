import { Module } from '@nestjs/common';
import { OraculoConfigModule } from '../config/config.module';
import { ConfiguracaoModule } from '../config/configuracao.module';
import { LLM_PROVIDER } from './llm-provider';
import { ResolvedorDeProvedor } from './resolvedor';

@Module({
  imports: [OraculoConfigModule, ConfiguracaoModule],
  providers: [
    ResolvedorDeProvedor,
    { provide: LLM_PROVIDER, useExisting: ResolvedorDeProvedor },
  ],
  exports: [LLM_PROVIDER, ResolvedorDeProvedor],
})
export class ProvidersModule {}
