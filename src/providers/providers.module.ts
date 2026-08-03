import { Module } from '@nestjs/common';
import { OraculoConfigModule } from '../config/config.module';
import { OraculoConfig } from '../config/config.service';
import { LLM_PROVIDER } from './llm-provider';
import { criarLlmProvider } from './provider.factory';

@Module({
  imports: [OraculoConfigModule],
  providers: [
    {
      provide: LLM_PROVIDER,
      inject: [OraculoConfig],
      useFactory: (config: OraculoConfig) => criarLlmProvider(config),
    },
  ],
  exports: [LLM_PROVIDER],
})
export class ProvidersModule {}
