import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Repository } from 'typeorm';
import { resolverRaizes } from '../capabilities/codigo/seguranca';
import { OraculoConfig } from '../config/config.service';
import { ConfiguracaoService } from '../config/configuracao.service';
import { resolverCaminhoNasRaizes } from '../config/raiz-permitida';
import { NEGADOS_PADRAO } from '../config/env.schema';
import { Documento } from '../database/entities';
import { AmbienteService } from './ambiente.service';

const ULTIMA_INDEXACAO = new Date('2026-08-01T10:00:00.000Z');

interface ConstrutorFalso {
  select: () => ConstrutorFalso;
  addSelect: () => ConstrutorFalso;
  groupBy: () => ConstrutorFalso;
  addGroupBy: () => ConstrutorFalso;
  orderBy: () => ConstrutorFalso;
  getRawMany: () => Promise<Record<string, string>[]>;
}

function documentosFalsos(): Repository<Documento> {
  const construtor: ConstrutorFalso = {
    select: () => construtor,
    addSelect: () => construtor,
    groupBy: () => construtor,
    addGroupBy: () => construtor,
    orderBy: () => construtor,
    getRawMany: () =>
      Promise.resolve([
        { fonte: 'memoria', autoridade: '1', documentos: '12' },
        { fonte: 'doc', autoridade: '2', documentos: '30' },
      ]),
  };

  return {
    createQueryBuilder: () => construtor,
    findOne: () =>
      Promise.resolve({ atualizadoEm: ULTIMA_INDEXACAO } as Documento),
  } as unknown as Repository<Documento>;
}

function configuracaoFalsa(): ConfiguracaoService {
  return {
    capacidadesEfetivas: () =>
      Promise.resolve([
        { capacidade: 'conhecimento', ligada: true, tetoDoEnv: true },
        {
          capacidade: 'banco',
          ligada: false,
          tetoDoEnv: false,
          motivoIndisponivel: 'CAP_BANCO=off no .env desta instalação',
        },
      ]),
    fontesEfetivas: () =>
      Promise.resolve([
        {
          id: null,
          caminho: '/corpus/memoria',
          rotulo: 'memoria',
          origem: 'env',
          removivel: false,
        },
      ]),
    alvosBanco: () =>
      Promise.resolve([
        {
          id: 'a1',
          nome: 'producao',
          schemas: ['public'],
          colunasMascaradas: [],
          ativo: true,
          criadoEm: ULTIMA_INDEXACAO,
          conexao: {
            host: '10.0.•.•',
            porta: '5432',
            base: 'producao',
            usuario: 'oraculo',
          },
        },
      ]),
    servicosObservaveis: () => Promise.resolve([]),
  } as unknown as ConfiguracaoService;
}

function configFalsa(): OraculoConfig {
  return {
    provedor: {
      tipo: 'cli',
      cliComando: 'agy',
      cliModelo: 'gemini-3.6-flash-medium',
    },
  } as unknown as OraculoConfig;
}

describe('AmbienteService', () => {
  it('consolida o estado do ambiente', async () => {
    const servico = new AmbienteService(
      configFalsa(),
      configuracaoFalsa(),
      documentosFalsos(),
    );

    const estado = await servico.estado();

    expect(estado.corpus).toEqual({
      total: 42,
      porFonte: [
        { fonte: 'memoria', autoridade: 1, documentos: 12 },
        { fonte: 'doc', autoridade: 2, documentos: 30 },
      ],
    });
    expect(estado.provedor).toEqual({
      tipo: 'cli',
      modelo: 'gemini-3.6-flash-medium',
    });
    expect(estado.ultimaIndexacao).toEqual(ULTIMA_INDEXACAO);
    expect(estado.fontes[0]).toMatchObject({
      origem: 'env',
      removivel: false,
    });
    expect(estado.capacidades[1].motivoIndisponivel).toContain('CAP_BANCO=off');
  });

  it('não devolve credencial de alvo de banco em nenhum ponto da resposta', async () => {
    const servico = new AmbienteService(
      configFalsa(),
      configuracaoFalsa(),
      documentosFalsos(),
    );

    const estado = await servico.estado();
    const serializado = JSON.stringify(estado);

    expect(serializado).not.toContain('postgres://');
    expect(serializado).not.toMatch(/senha|password/i);
    expect(estado.alvosBanco[0]).not.toHaveProperty('url');
    expect(estado.alvosBanco[0].conexao.host).toBe('10.0.•.•');
  });
});

describe('AmbienteService.previaDeFonte', () => {
  let raizPermitida: string;
  let fora: string;
  let servico: AmbienteService;

  beforeEach(async () => {
    raizPermitida = await realpath(
      await mkdtemp(join(tmpdir(), 'oraculo-raiz-')),
    );
    fora = await realpath(await mkdtemp(join(tmpdir(), 'oraculo-fora-')));

    const config = {
      corpus: { negados: NEGADOS_PADRAO.split(',') },
    } as unknown as OraculoConfig;

    const configuracao = {
      resolverCaminhoDeFonte: (caminho: string) =>
        resolverCaminhoNasRaizes(caminho, resolverRaizes([raizPermitida])),
    } as unknown as ConfiguracaoService;

    servico = new AmbienteService(config, configuracao, documentosFalsos());
  });

  afterEach(async () => {
    await rm(raizPermitida, { recursive: true, force: true });
    await rm(fora, { recursive: true, force: true });
  });

  it('varre uma pasta dentro da raiz permitida sem indexar nada', async () => {
    const pasta = join(raizPermitida, 'documentos');

    await mkdir(pasta);
    await writeFile(join(pasta, 'guia.md'), '# Guia');
    await writeFile(join(pasta, 'secrets.local.md'), '# segredo');

    const previa = await servico.previaDeFonte(pasta);

    expect(previa).toMatchObject({
      caminho: pasta,
      existe: true,
      legivel: true,
      arquivosElegiveis: 1,
      arquivosRecusados: 1,
      truncada: false,
    });
    expect(previa.porExtensao).toEqual({ '.md': 1 });
    expect(previa.motivosDeRecusa).toEqual({ denylist: 1 });
  });

  it('responde existe: false para caminho inexistente dentro da raiz', async () => {
    const previa = await servico.previaDeFonte(
      join(raizPermitida, 'nao-existe'),
    );

    expect(previa.existe).toBe(false);
    expect(previa.legivel).toBe(false);
    expect(previa.arquivosElegiveis).toBe(0);
    expect(previa.amostra).toEqual([]);
  });

  it('recusa caminho fora das raízes permitidas', async () => {
    await expect(servico.previaDeFonte(fora)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('recusa symlink dentro da raiz que aponta para fora dela', async () => {
    await writeFile(join(fora, 'segredo.md'), '# fora do teto');

    const atalho = join(raizPermitida, 'atalho');
    await symlink(fora, atalho);

    await expect(servico.previaDeFonte(atalho)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('recusa symlink dentro da raiz que aponta para /etc', async () => {
    const atalho = join(raizPermitida, 'etc');
    await symlink('/etc', atalho);

    await expect(servico.previaDeFonte(atalho)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('recusa caminho relativo e travessia de diretório', async () => {
    await expect(servico.previaDeFonte('documentos')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    await expect(
      servico.previaDeFonte(`${raizPermitida}/../outro`),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(servico.previaDeFonte('')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('recusa caminho que não é pasta', async () => {
    const arquivo = join(raizPermitida, 'guia.md');

    await writeFile(arquivo, '# Guia');

    await expect(servico.previaDeFonte(arquivo)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
