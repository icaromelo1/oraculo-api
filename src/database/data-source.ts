import 'dotenv/config';
import { DataSource } from 'typeorm';
import { validarEnv } from '../config/env.schema';
import { entidades } from './entities';

const env = validarEnv(process.env);

const AppDataSource = new DataSource({
  type: 'postgres',
  url: env.DATABASE_URL,
  entities: entidades,
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
});

export default AppDataSource;
