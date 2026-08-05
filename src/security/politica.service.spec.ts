import { Repository } from 'typeorm';
import { OraculoConfig } from '../config/config.service';
import { PerfilCapacidade, StatusPerfilCapacidade } from '../database/entities';
import { PoliticaService } from './politica.service';
import type {
  AlcancePerfil,
  CapacidadeDoPerfil,
  PedidoFerramenta,
} from './tipos';

const config = {
  capacidades: {
    conhecimento: true,
    codigo: true,
    estado: true,
    banco: true,
  },
  escopos: {
    repos: ['/repos/oraculo'],
    comandos: ['docker ps', 'pm2 list'],
    bancos: ['oraculo'],
  },
  corpus: {
    fontes: ['/docs'],
    negados: ['.env*', '*.key', 'secrets*', '**/node_modules/**'],
  },
} as unknown as OraculoConfig;

const repositorio = {
  find: jest.fn(),
} as unknown as Repository<PerfilCapacidade>;

const linha = (
  capacidade: string,
  status: StatusPerfilCapacidade,
  escopo: Record<string, unknown> | null = null,
): CapacidadeDoPerfil => ({ capacidade, status, escopo });

const dono = (...capacidades: CapacidadeDoPerfil[]): AlcancePerfil => ({
  perfilId: 'perfil-dono',
  perfil: 'dono',
  capacidades,
});

const pedido = (
  capacidade: string,
  argumentos: Record<string, unknown>,
  alcance: AlcancePerfil,
): PedidoFerramenta => ({ capacidade, argumentos, alcance });

describe('PoliticaService', () => {
  const servico = new PoliticaService(config, repositorio);

  describe('o que nao esta explicitamente permitido e negado', () => {
    it('bloqueia capacidade fora do catalogo', () => {
      const veredito = servico.avaliar(
        pedido(
          'executar_shell',
          { comando: 'rm -rf /' },
          dono(linha('ler_arquivo', StatusPerfilCapacidade.PERMITIDA)),
        ),
      );

      expect(veredito.decisao).toBe('bloquear');
      expect(veredito.politica).toBe('capacidade_desconhecida');
      expect(veredito.motivo).toContain('executar_shell');
    });

    it('bloqueia capacidade conhecida que o perfil nao tem na matriz', () => {
      const veredito = servico.avaliar(
        pedido(
          'ler_arquivo',
          { caminho: '/repos/oraculo/src/main.ts' },
          dono(),
        ),
      );

      expect(veredito.decisao).toBe('bloquear');
      expect(veredito.politica).toBe('sem_permissao_explicita');
    });

    it('bloqueia capacidade marcada como negada no perfil', () => {
      const veredito = servico.avaliar(
        pedido(
          'ler_arquivo',
          { caminho: '/repos/oraculo/src/main.ts' },
          dono(linha('ler_arquivo', StatusPerfilCapacidade.NEGADA)),
        ),
      );

      expect(veredito.decisao).toBe('bloquear');
      expect(veredito.politica).toBe('negada_no_perfil');
    });

    it('bloqueia capacidade desligada por ENV nesta instancia', () => {
      const desligado = new PoliticaService(
        {
          ...config,
          capacidades: { ...config.capacidades, banco: false },
        } as unknown as OraculoConfig,
        repositorio,
      );

      const veredito = desligado.avaliar(
        pedido(
          'consultar_banco',
          { alvo: 'oraculo', sql: 'select 1' },
          dono(linha('consultar_banco', StatusPerfilCapacidade.PERMITIDA)),
        ),
      );

      expect(veredito.decisao).toBe('bloquear');
      expect(veredito.politica).toBe('capacidade_desligada');
    });
  });

  describe('capacidade sensivel', () => {
    it('exige aprovacao para consultar_banco mesmo permitida na matriz', () => {
      const veredito = servico.avaliar(
        pedido(
          'consultar_banco',
          { alvo: 'oraculo', sql: 'select count(*) from trecho' },
          dono(linha('consultar_banco', StatusPerfilCapacidade.PERMITIDA)),
        ),
      );

      expect(veredito.decisao).toBe('exigir_aprovacao');
      expect(veredito.politica).toBe('capacidade_sensivel');
    });

    it('exige aprovacao para estado_servicos mesmo permitida na matriz', () => {
      const veredito = servico.avaliar(
        pedido(
          'estado_servicos',
          { comando: 'docker ps' },
          dono(linha('estado_servicos', StatusPerfilCapacidade.PERMITIDA)),
        ),
      );

      expect(veredito.decisao).toBe('exigir_aprovacao');
    });

    it('exige aprovacao quando a matriz marca aprovacao', () => {
      const veredito = servico.avaliar(
        pedido(
          'ler_arquivo',
          { caminho: '/repos/oraculo/src/main.ts' },
          dono(linha('ler_arquivo', StatusPerfilCapacidade.APROVACAO)),
        ),
      );

      expect(veredito.decisao).toBe('exigir_aprovacao');
      expect(veredito.politica).toBe('aprovacao_exigida_no_perfil');
    });
  });

  describe('argumentos e escopo', () => {
    const comLeitura = dono(
      linha('ler_arquivo', StatusPerfilCapacidade.PERMITIDA),
      linha('buscar_conhecimento', StatusPerfilCapacidade.PERMITIDA),
      linha('consultar_banco', StatusPerfilCapacidade.PERMITIDA),
      linha('estado_servicos', StatusPerfilCapacidade.PERMITIDA),
    );

    it('permite leitura dentro da raiz liberada', () => {
      const veredito = servico.avaliar(
        pedido(
          'ler_arquivo',
          { caminho: '/repos/oraculo/src/main.ts' },
          comLeitura,
        ),
      );

      expect(veredito.decisao).toBe('permitir');
      expect(veredito.politica).toBe('permitida');
    });

    it('bloqueia leitura fora da raiz liberada', () => {
      const veredito = servico.avaliar(
        pedido('ler_arquivo', { caminho: '/etc/passwd' }, comLeitura),
      );

      expect(veredito.decisao).toBe('bloquear');
      expect(veredito.politica).toBe('fora_de_escopo');
    });

    it('bloqueia travessia de diretorio', () => {
      const veredito = servico.avaliar(
        pedido(
          'ler_arquivo',
          { caminho: '/repos/oraculo/../../etc/shadow' },
          comLeitura,
        ),
      );

      expect(veredito.decisao).toBe('bloquear');
      expect(veredito.politica).toBe('fora_de_escopo');
    });

    it('bloqueia caminho que casa com a lista de negacao', () => {
      const veredito = servico.avaliar(
        pedido('ler_arquivo', { caminho: '/repos/oraculo/.env' }, comLeitura),
      );

      expect(veredito.decisao).toBe('bloquear');
      expect(veredito.politica).toBe('caminho_negado');
    });

    it('bloqueia argumento obrigatorio ausente', () => {
      const veredito = servico.avaliar(
        pedido('buscar_conhecimento', {}, comLeitura),
      );

      expect(veredito.decisao).toBe('bloquear');
      expect(veredito.politica).toBe('argumento_invalido');
    });

    it('bloqueia SQL de escrita antes de pedir aprovacao', () => {
      const veredito = servico.avaliar(
        pedido(
          'consultar_banco',
          { alvo: 'oraculo', sql: 'update usuario set ativo = false' },
          comLeitura,
        ),
      );

      expect(veredito.decisao).toBe('bloquear');
      expect(veredito.politica).toBe('escrita_no_banco');
    });

    it('bloqueia escrita escondida em CTE e multiplas instrucoes', () => {
      const cte = servico.avaliar(
        pedido(
          'consultar_banco',
          {
            alvo: 'oraculo',
            sql: 'with morto as (delete from trecho returning *) select * from morto',
          },
          comLeitura,
        ),
      );

      const duas = servico.avaliar(
        pedido(
          'consultar_banco',
          { alvo: 'oraculo', sql: 'select 1; drop table trecho' },
          comLeitura,
        ),
      );

      expect(cte.politica).toBe('escrita_no_banco');
      expect(duas.politica).toBe('escrita_no_banco');
    });

    it('bloqueia banco fora da allowlist', () => {
      const veredito = servico.avaliar(
        pedido(
          'consultar_banco',
          { alvo: 'producao', sql: 'select 1' },
          comLeitura,
        ),
      );

      expect(veredito.politica).toBe('fora_de_escopo');
    });

    it('deixa descrever_schema passar sem sql, mas ainda exige aprovacao', () => {
      const veredito = servico.avaliar(
        pedido(
          'consultar_banco',
          { alvo: 'oraculo', operacao: 'descrever_schema' },
          comLeitura,
        ),
      );

      expect(veredito.decisao).toBe('exigir_aprovacao');
      expect(veredito.politica).toBe('capacidade_sensivel');
    });

    it('descrever_schema nao escapa da allowlist de banco', () => {
      const veredito = servico.avaliar(
        pedido(
          'consultar_banco',
          { alvo: 'producao', operacao: 'descrever_schema' },
          comLeitura,
        ),
      );

      expect(veredito.politica).toBe('fora_de_escopo');
    });

    it('bloqueia comando fora da allowlist de estado', () => {
      const veredito = servico.avaliar(
        pedido(
          'estado_servicos',
          { comando: 'docker rm -f oraculo-db' },
          comLeitura,
        ),
      );

      expect(veredito.decisao).toBe('bloquear');
      expect(veredito.politica).toBe('comando_fora_da_allowlist');
    });

    it('respeita o escopo gravado na linha do perfil acima do ENV', () => {
      const restrito = dono(
        linha('ler_arquivo', StatusPerfilCapacidade.PERMITIDA, {
          repositorios: ['/repos/kairos'],
        }),
      );

      expect(
        servico.avaliar(
          pedido(
            'ler_arquivo',
            { caminho: '/repos/kairos/src/a.ts' },
            restrito,
          ),
        ).decisao,
      ).toBe('permitir');

      expect(
        servico.avaliar(
          pedido(
            'ler_arquivo',
            { caminho: '/repos/oraculo/src/a.ts' },
            restrito,
          ),
        ).decisao,
      ).toBe('bloquear');
    });
  });

  it('carrega o alcance do perfil a partir da matriz perfil_capacidade', async () => {
    (repositorio.find as jest.Mock).mockResolvedValueOnce([
      {
        capacidade: 'ler_arquivo',
        status: StatusPerfilCapacidade.PERMITIDA,
        escopo: null,
        perfil: { id: 'perfil-dono', nome: 'dono' },
      },
    ]);

    const alcance = await servico.carregarAlcance('perfil-dono');

    expect(alcance).toEqual({
      perfilId: 'perfil-dono',
      perfil: 'dono',
      capacidades: [
        {
          capacidade: 'ler_arquivo',
          status: StatusPerfilCapacidade.PERMITIDA,
          escopo: null,
        },
      ],
    });
  });
});
