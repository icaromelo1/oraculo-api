import 'dotenv/config';
import * as argon2 from 'argon2';
import { validarEnv } from '../config/env.schema';
import AppDataSource from '../database/data-source';
import {
  Perfil,
  PerfilCapacidade,
  StatusPerfilCapacidade,
  Usuario,
} from '../database/entities';

const PERFIL_DONO = 'dono';

async function seed(): Promise<void> {
  const env = validarEnv(process.env);
  const login = process.env.SEED_LOGIN;
  const senha = process.env.SEED_SENHA;

  if (!login || !senha) {
    throw new Error(
      'SEED_LOGIN e SEED_SENHA são obrigatórias para rodar o seed',
    );
  }

  await AppDataSource.initialize();

  try {
    const perfilRepo = AppDataSource.getRepository(Perfil);
    const usuarioRepo = AppDataSource.getRepository(Usuario);
    const capacidadeRepo = AppDataSource.getRepository(PerfilCapacidade);

    let perfil = await perfilRepo.findOne({ where: { nome: PERFIL_DONO } });

    if (!perfil) {
      perfil = await perfilRepo.save(
        perfilRepo.create({
          nome: PERFIL_DONO,
          descricao: 'Perfil com acesso total à instância',
        }),
      );
      console.log(`perfil "${PERFIL_DONO}" criado`);
    } else {
      console.log(`perfil "${PERFIL_DONO}" já existe`);
    }

    const usuarioExistente = await usuarioRepo.findOne({ where: { login } });

    if (!usuarioExistente) {
      const senhaHash = await argon2.hash(senha, { type: argon2.argon2id });

      await usuarioRepo.save(
        usuarioRepo.create({
          login,
          senhaHash,
          nome: process.env.SEED_NOME ?? 'Dono',
          ativo: true,
          perfil,
        }),
      );
      console.log(`usuário "${login}" criado`);
    } else {
      console.log(`usuário "${login}" já existe — senha preservada`);
    }

    const capacidadesHabilitadas: string[] = [
      ['conhecimento', env.CAP_CONHECIMENTO],
      ['codigo', env.CAP_CODIGO],
      ['estado', env.CAP_ESTADO],
      ['banco', env.CAP_BANCO],
    ]
      .filter(([, habilitada]) => habilitada)
      .map(([nome]) => nome as string);

    for (const capacidade of capacidadesHabilitadas) {
      const existente = await capacidadeRepo.findOne({
        where: { perfil: { id: perfil.id }, capacidade },
      });

      if (existente) {
        console.log(
          `capacidade "${capacidade}" já concedida ao perfil "${PERFIL_DONO}"`,
        );
        continue;
      }

      await capacidadeRepo.save(
        capacidadeRepo.create({
          perfil,
          capacidade,
          status: StatusPerfilCapacidade.PERMITIDA,
          escopo: null,
        }),
      );
      console.log(
        `capacidade "${capacidade}" concedida ao perfil "${PERFIL_DONO}"`,
      );
    }
  } finally {
    await AppDataSource.destroy();
  }
}

seed()
  .then(() => {
    console.log('seed concluído');
    process.exit(0);
  })
  .catch((erro: unknown) => {
    console.error('seed falhou:', erro instanceof Error ? erro.message : erro);
    process.exit(1);
  });
