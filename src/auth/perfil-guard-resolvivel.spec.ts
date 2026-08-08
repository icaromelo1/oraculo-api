import { Controller, Get, Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { OraculoConfig } from '../config/config.service';
import { Perfil, PerfilCapacidade, Usuario } from '../database/entities';
import { AuthModule } from './auth.module';
import { ExigePerfil, PERFIL_DONO } from './exige-perfil.decorator';

@Controller('rota-administrativa')
class ControladorProtegido {
  @ExigePerfil(PERFIL_DONO)
  @Get()
  ler(): string {
    return 'ok';
  }
}

@Module({ imports: [AuthModule], controllers: [ControladorProtegido] })
class ModuloConsumidor {}

const CONFIG = {
  auth: { modo: 'local', segredo: 'segredo-de-teste', ttl: '1h' },
} as unknown as OraculoConfig;

@Global()
@Module({
  providers: [{ provide: OraculoConfig, useValue: CONFIG }],
  exports: [OraculoConfig],
})
class ConfigFalso {}

describe('PerfilGuard fora do módulo que o declara', () => {
  it('resolve as dependências num módulo que só importa o AuthModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigFalso, ModuloConsumidor],
    })
      .overrideProvider(getDataSourceToken())
      .useValue({ getRepository: () => ({}) })
      .overrideProvider(getRepositoryToken(Usuario))
      .useValue({ findOne: jest.fn() })
      .overrideProvider(getRepositoryToken(Perfil))
      .useValue({})
      .overrideProvider(getRepositoryToken(PerfilCapacidade))
      .useValue({})
      .compile();

    const app = moduleRef.createNestApplication();

    await expect(app.init()).resolves.toBeDefined();
    await app.close();
  });
});
