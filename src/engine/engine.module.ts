import { Module } from '@nestjs/common';
import { CapabilitiesModule } from '../capabilities/capabilities.module';
import { ConfiguracaoModule } from '../config/configuracao.module';
import { ProvidersModule } from '../providers/providers.module';
import { SecurityModule } from '../security/security.module';
import { MotorOraculo } from './motor.service';

@Module({
  imports: [
    ProvidersModule,
    SecurityModule,
    CapabilitiesModule,
    ConfiguracaoModule,
  ],
  providers: [MotorOraculo],
  exports: [MotorOraculo],
})
export class EngineModule {}
