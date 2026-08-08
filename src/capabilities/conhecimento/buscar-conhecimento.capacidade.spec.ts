import { Repository } from 'typeorm';
import type { OraculoConfig } from '../../config/config.service';
import type {
  ConfiguracaoService,
  ModuloIdentificado,
} from '../../config/configuracao.service';
import type { EmbeddingService } from '../../corpus/embedding.service';
import { Trecho } from '../../database/entities';
import { BuscarConhecimentoCapacidade } from './buscar-conhecimento.capacidade';

const ID_DO_MODULO = '11111111-2222-3333-4444-555555555555';

interface Consulta {
  sql: string;
  parametros: unknown[];
}

function configFalsa(
  modo: 'hibrido' | 'lexical' | 'vetorial' = 'hibrido',
): OraculoConfig {
  return {
    corpus: { fontes: ['/corpus'], negados: [] },
    recuperacao: { modo, modeloEmbedding: 'x', dimensoes: 3 },
  } as unknown as OraculoConfig;
}

function linha(caminho: string) {
  return {
    id: caminho,
    texto: `conteudo de ${caminho}`,
    linhaInicio: 1,
    linhaFim: 4,
    caminho,
    titulo: caminho,
    fonte: 'memoria',
    autoridade: 1,
  };
}

function montar(
  modulos: ModuloIdentificado[],
  modo: 'hibrido' | 'lexical' | 'vetorial' = 'hibrido',
) {
  const consultas: Consulta[] = [];

  const executar = (sql: string, parametros: unknown[] = []) => {
    consultas.push({ sql, parametros });

    return Promise.resolve(
      sql.includes('SET LOCAL') ? [] : [linha('/corpus/memoria.md')],
    );
  };

  const trechos = {
    query: jest.fn((sql: string, parametros?: unknown[]) =>
      executar(sql, parametros),
    ),
    manager: {
      transaction: jest.fn(
        (acao: (gerente: { query: typeof executar }) => Promise<unknown>) =>
          acao({ query: executar }),
      ),
    },
  } as unknown as Repository<Trecho>;

  const embedding = {
    embutir: jest.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
  } as unknown as EmbeddingService;

  const identificarModulo = jest.fn((nome: string) =>
    Promise.resolve(
      modulos.find(
        (modulo) => modulo.nome.toLowerCase() === nome.trim().toLowerCase(),
      ) ?? null,
    ),
  );

  const configuracao = { identificarModulo } as unknown as ConfiguracaoService;

  const capacidade = new BuscarConhecimentoCapacidade(
    configFalsa(modo),
    embedding,
    trechos,
    configuracao,
  );

  return { capacidade, consultas, identificarModulo };
}

function buscas(consultas: Consulta[]): Consulta[] {
  return consultas.filter((consulta) => !consulta.sql.includes('SET LOCAL'));
}

describe('buscar_conhecimento com modulo', () => {
  it('anuncia o parametro modulo como opcional', () => {
    const { capacidade } = montar([]);
    const modulo = capacidade.parametros.find(
      (parametro) => parametro.nome === 'modulo',
    );

    expect(modulo).toMatchObject({ tipo: 'string', obrigatorio: false });
  });

  it('filtra as duas pernas da busca quando o modulo existe', async () => {
    const { capacidade, consultas } = montar([
      { id: ID_DO_MODULO, nome: 'memoria e preferencias' },
    ]);

    const resultado = await capacidade.executar({
      consulta: 'onde roda o oraculo',
      modulo: 'memoria e preferencias',
    });

    const executadas = buscas(consultas);

    expect(executadas).toHaveLength(2);

    for (const consulta of executadas) {
      expect(consulta.sql).toContain('d.modulo_id = $3');
      expect(consulta.parametros[2]).toBe(ID_DO_MODULO);
    }

    expect(executadas[0].sql).toContain('websearch_to_tsquery');
    expect(executadas[1].sql).toContain('<=> $1::vector');
    expect(resultado.metrica).toContain('módulo "memoria e preferencias"');
  });

  it('casa o nome do modulo sem depender de caixa nem de espaco sobrando', async () => {
    const { capacidade, consultas } = montar([
      { id: ID_DO_MODULO, nome: 'memoria e preferencias' },
    ]);

    await capacidade.executar({
      consulta: 'vm',
      modulo: '  Memoria E Preferencias  ',
    });

    expect(buscas(consultas)[0].parametros[2]).toBe(ID_DO_MODULO);
  });

  it('busca sem filtro nenhum quando o modulo nao foi pedido', async () => {
    const { capacidade, consultas, identificarModulo } = montar([
      { id: ID_DO_MODULO, nome: 'memoria e preferencias' },
    ]);

    const resultado = await capacidade.executar({ consulta: 'vm' });

    expect(identificarModulo).not.toHaveBeenCalled();

    for (const consulta of buscas(consultas)) {
      expect(consulta.sql).not.toContain('modulo_id');
      expect(consulta.parametros).toHaveLength(2);
    }

    expect(resultado.metrica).not.toContain('módulo');
  });

  it('modulo inexistente devolve resultado normal e avisa na metrica', async () => {
    const { capacidade, consultas } = montar([
      { id: ID_DO_MODULO, nome: 'memoria e preferencias' },
    ]);

    const resultado = await capacidade.executar({
      consulta: 'vm',
      modulo: 'financeiro',
    });

    for (const consulta of buscas(consultas)) {
      expect(consulta.sql).not.toContain('modulo_id');
      expect(consulta.parametros).toHaveLength(2);
    }

    expect(resultado.volume).toBeGreaterThan(0);
    expect(resultado.retornos).not.toHaveLength(0);
    expect(resultado.metrica).toContain('"financeiro" não existe no mapa');
    expect(resultado.metrica).toContain('sem filtro de módulo');
  });

  it('filtra tambem quando o modo e so lexical', async () => {
    const { capacidade, consultas } = montar(
      [{ id: ID_DO_MODULO, nome: 'vm' }],
      'lexical',
    );

    await capacidade.executar({ consulta: 'vm', modulo: 'vm' });

    const executadas = buscas(consultas);

    expect(executadas).toHaveLength(1);
    expect(executadas[0].sql).toContain('d.modulo_id = $3');
  });

  it('sem ConfiguracaoService, modulo pedido nao vira busca vazia', async () => {
    const { consultas } = montar([]);
    const capacidade = new BuscarConhecimentoCapacidade(
      configFalsa('lexical'),
      { embutir: jest.fn() } as unknown as EmbeddingService,
      {
        query: jest.fn((sql: string, parametros: unknown[] = []) => {
          consultas.push({ sql, parametros });

          return Promise.resolve([linha('/corpus/a.md')]);
        }),
      } as unknown as Repository<Trecho>,
    );

    const resultado = await capacidade.executar({
      consulta: 'vm',
      modulo: 'qualquer',
    });

    expect(buscas(consultas)[0].sql).not.toContain('modulo_id');
    expect(resultado.volume).toBe(1);
    expect(resultado.metrica).toContain('não existe no mapa');
  });
});
