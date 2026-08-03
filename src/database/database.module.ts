import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OraculoConfig } from '../config/config.service';
import { OraculoConfigModule } from '../config/config.module';
import { entidades } from './entities';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [OraculoConfigModule],
      inject: [OraculoConfig],
      useFactory: (config: OraculoConfig) => ({
        type: 'postgres',
        url: config.bancoUrl,
        entities: entidades,
        migrations: [__dirname + '/migrations/*{.ts,.js}'],
        synchronize: false,
        migrationsRun: false,
      }),
    }),
  ],
})
export class DatabaseModule {}
