import { Inject, Injectable, Optional } from '@nestjs/common';
import { OraculoConfig } from '../config/config.service';
import type { NomeFerramenta } from '../contracts/eventos';
import type { AlcancePerfil } from '../security/tipos';
import { CAPACIDADE, Capacidade } from './capacidade';

@Injectable()
export class RegistryCapacidades {
  private readonly porNome = new Map<NomeFerramenta, Capacidade>();

  constructor(
    private readonly config: OraculoConfig,
    @Optional() @Inject(CAPACIDADE) capacidades: Capacidade[] | null,
  ) {
    for (const capacidade of capacidades ?? []) {
      this.porNome.set(capacidade.nome, capacidade);
    }
  }

  todas(): Capacidade[] {
    return [...this.porNome.values()];
  }

  ligadaNaInstalacao(capacidade: Capacidade): boolean {
    return this.config.capacidades[capacidade.chaveEnv];
  }

  alcancadaPeloPerfil(capacidade: Capacidade, alcance: AlcancePerfil): boolean {
    const linha = alcance.capacidades.find(
      (item) => item.capacidade === capacidade.nome,
    );
    return linha !== undefined && linha.status !== 'negada';
  }

  disponiveisPara(alcance: AlcancePerfil): Capacidade[] {
    return this.todas().filter(
      (capacidade) =>
        this.ligadaNaInstalacao(capacidade) &&
        this.alcancadaPeloPerfil(capacidade, alcance),
    );
  }

  obter(nome: string): Capacidade | undefined {
    return this.porNome.get(nome as NomeFerramenta);
  }

  obterDisponivel(
    nome: string,
    alcance: AlcancePerfil,
  ): Capacidade | undefined {
    const capacidade = this.obter(nome);
    if (!capacidade) {
      return undefined;
    }
    return this.disponiveisPara(alcance).includes(capacidade)
      ? capacidade
      : undefined;
  }

  descreverPara(alcance: AlcancePerfil): string {
    const disponiveis = this.disponiveisPara(alcance);

    if (disponiveis.length === 0) {
      return 'Nenhuma ferramenta está disponível nesta sessão.';
    }

    return disponiveis
      .map((capacidade) => {
        const parametros = capacidade.parametros
          .map(
            (parametro) =>
              `${parametro.nome}${parametro.obrigatorio ? '' : '?'}: ${parametro.tipo}`,
          )
          .join(', ');
        return `- ${capacidade.nome}(${parametros}) — ${capacidade.descricao}`;
      })
      .join('\n');
  }
}
