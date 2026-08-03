import { Module } from '@nestjs/common';
import { RegistryCapacidades } from './registry.service';

@Module({
  providers: [RegistryCapacidades],
  exports: [RegistryCapacidades],
})
export class CapabilitiesModule {}
