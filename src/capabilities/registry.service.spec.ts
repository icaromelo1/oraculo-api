import { OraculoConfig } from '../config/config.service';
import { ConfiguracaoService } from '../config/configuracao.service';
import { StatusPerfilCapacidade } from '../database/entities';
import type { AlcancePerfil } from '../security/tipos';
import { Capacidade } from './capacidade';
import { RegistryCapacidades } from './registry.service';

function capacidadeFalsa(
  nome: string,
  chaveEnv: Capacidade['chaveEnv'],
  sensivel = false,
): Capacidade {
  return {
    nome: nome as Capacidade['nome'],
    descricao: `faz ${nome}`,
    sensivel,
    chaveEnv,
    parametros: [
      {
        nome: 'consulta',
        tipo: 'string',
        descricao: 'texto',
        obrigatorio: true,
      },
    ],
    executar: () =>
      Promise.resolve({ retornos: [], metrica: '0 itens', volume: 0 }),
  };
}

function configFalsa(capacidades: Record<string, boolean>): OraculoConfig {
  return {
    capacidades: {
      conhecimento: capacidades.conhecimento ?? true,
      codigo: capacidades.codigo ?? true,
      estado: capacidades.estado ?? false,
      banco: capacidades.banco ?? false,
    },
  } as OraculoConfig;
}

const alcance: AlcancePerfil = {
  perfilId: 'p1',
  perfil: 'dono',
  capacidades: [
    {
      capacidade: 'buscar_conhecimento',
      status: StatusPerfilCapacidade.PERMITIDA,
      escopo: null,
    },
    {
      capacidade: 'consultar_banco',
      status: StatusPerfilCapacidade.APROVACAO,
      escopo: null,
    },
    {
      capacidade: 'estado_servicos',
      status: StatusPerfilCapacidade.NEGADA,
      escopo: null,
    },
  ],
};

describe('RegistryCapacidades', () => {
  const conhecimento = capacidadeFalsa('buscar_conhecimento', 'conhecimento');
  const banco = capacidadeFalsa('consultar_banco', 'banco', true);
  const estado = capacidadeFalsa('estado_servicos', 'estado', true);
  const codigo = capacidadeFalsa('buscar_codigo', 'codigo');

  it('não apresenta capacidade desligada na instalação', () => {
    const registry = new RegistryCapacidades(configFalsa({ banco: false }), [
      conhecimento,
      banco,
    ]);

    expect(registry.disponiveisPara(alcance)).toEqual([conhecimento]);
  });

  it('não apresenta capacidade negada ao perfil mesmo se ligada', () => {
    const registry = new RegistryCapacidades(configFalsa({ estado: true }), [
      conhecimento,
      estado,
    ]);

    expect(registry.disponiveisPara(alcance)).toEqual([conhecimento]);
  });

  it('não apresenta capacidade sem linha no perfil (ausência é negação)', () => {
    const registry = new RegistryCapacidades(configFalsa({}), [
      conhecimento,
      codigo,
    ]);

    expect(registry.disponiveisPara(alcance)).toEqual([conhecimento]);
  });

  it('apresenta capacidade que exige aprovação, quando ligada', () => {
    const registry = new RegistryCapacidades(configFalsa({ banco: true }), [
      conhecimento,
      banco,
    ]);

    expect(registry.disponiveisPara(alcance)).toEqual([conhecimento, banco]);
  });

  it('obterDisponivel não devolve o que o perfil não alcança', () => {
    const registry = new RegistryCapacidades(configFalsa({ estado: true }), [
      conhecimento,
      estado,
    ]);

    expect(registry.obterDisponivel('buscar_conhecimento', alcance)).toBe(
      conhecimento,
    );
    expect(
      registry.obterDisponivel('estado_servicos', alcance),
    ).toBeUndefined();
    expect(registry.obterDisponivel('inexistente', alcance)).toBeUndefined();
  });

  it('descreve para o modelo somente o que está disponível', () => {
    const registry = new RegistryCapacidades(configFalsa({ banco: false }), [
      conhecimento,
      banco,
    ]);
    const descricao = registry.descreverPara(alcance);

    expect(descricao).toContain('buscar_conhecimento(consulta: string)');
    expect(descricao).not.toContain('consultar_banco');
  });

  it('avisa quando nada está disponível', () => {
    const registry = new RegistryCapacidades(configFalsa({}), []);

    expect(registry.descreverPara(alcance)).toBe(
      'Nenhuma ferramenta está disponível nesta sessão.',
    );
  });

  it('respeita o recorte do ConfiguracaoService quando ele existe', () => {
    const configuracao = {
      capacidadeLigada: (nome: string) => nome !== 'banco',
    } as unknown as ConfiguracaoService;

    const registry = new RegistryCapacidades(
      configFalsa({ banco: true }),
      [conhecimento, banco],
      configuracao,
    );

    expect(registry.disponiveisPara(alcance)).toEqual([conhecimento]);
  });

  it('nunca amplia o que o ENV proíbe, mesmo com o ConfiguracaoService', () => {
    const configuracao = {
      capacidadeLigada: () => true,
    } as unknown as ConfiguracaoService;

    const registry = new RegistryCapacidades(
      configFalsa({ banco: false }),
      [conhecimento, banco],
      configuracao,
    );

    expect(registry.disponiveisPara(alcance)).toEqual([conhecimento]);
  });
});
