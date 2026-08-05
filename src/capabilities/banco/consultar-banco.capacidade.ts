import { Injectable } from '@nestjs/common';
import { OraculoConfig } from '../../config/config.service';
import {
  ConfiguracaoService,
  type AlvoBancoResumido,
} from '../../config/configuracao.service';
import { SanitizadorDiagnostico } from '../../security/sanitizador-diagnostico';
import type { RetornoFerramenta } from '../../security/tipos';
import type {
  Capacidade,
  ParametroCapacidade,
  ResultadoCapacidade,
} from '../capacidade';
import {
  formatarSchema,
  formatarTabela,
  type TabelaFormatada,
} from './apresentacao';
import { ExecutorConsulta } from './executor-consulta.service';
import {
  schemasBemFormados,
  TETO_DE_LINHAS_PADRAO,
  validarConsulta,
} from './sql-seguro';

export const OPERACOES = ['consultar', 'descrever_schema'] as const;

export type Operacao = (typeof OPERACOES)[number];

const NOME_DE_TABELA = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

interface AlvoResolvido {
  readonly alvo: AlvoBancoResumido;
  readonly schemas: string[];
  readonly url: string;
}

type ResolucaoAlvo =
  | { readonly ok: true; readonly valor: AlvoResolvido }
  | { readonly ok: false; readonly motivo: string };

@Injectable()
export class ConsultarBancoCapacidade implements Capacidade {
  readonly nome = 'consultar_banco' as const;
  readonly descricao =
    'consulta somente leitura em um alvo de banco cadastrado: operacao="consultar" roda um único SELECT (sem escrita, sem função fora da allowlist, com LIMIT imposto) e operacao="descrever_schema" lista tabelas e colunas dos schemas liberados';
  readonly sensivel = true;
  readonly chaveEnv = 'banco' as const;
  readonly parametros: ParametroCapacidade[] = [
    {
      nome: 'alvo',
      tipo: 'string',
      descricao:
        'nome de um alvo cadastrado e ativo em alvo_banco — qualquer outro nome é recusado',
      obrigatorio: true,
    },
    {
      nome: 'operacao',
      tipo: 'string',
      descricao: `o que fazer no alvo: ${OPERACOES.join(' ou ')} (padrão consultar)`,
      obrigatorio: false,
    },
    {
      nome: 'sql',
      tipo: 'string',
      descricao:
        'um único SELECT (ou WITH … SELECT), exigido por operacao="consultar"',
      obrigatorio: false,
    },
    {
      nome: 'tabela',
      tipo: 'string',
      descricao:
        'restringe descrever_schema a uma tabela; sem ele o schema inteiro é descrito',
      obrigatorio: false,
    },
  ];

  constructor(
    private readonly executor: ExecutorConsulta,
    private readonly sanitizador: SanitizadorDiagnostico,
    private readonly config: OraculoConfig,
    private readonly configuracao: ConfiguracaoService,
  ) {}

  async executar(
    argumentos: Record<string, unknown>,
  ): Promise<ResultadoCapacidade> {
    if (!this.config.capacidades.banco) {
      return this.bloqueio('CAP_BANCO=off no .env desta instalação');
    }

    if (!this.configuracao.capacidadeLigada('banco')) {
      return this.bloqueio(
        'consulta a banco desligada na configuração do Oráculo',
      );
    }

    const operacao = this.operacaoPedida(argumentos.operacao);

    if (!operacao) {
      return this.bloqueio(
        `operação fora do catálogo — as únicas aceitas são ${OPERACOES.join(', ')}`,
      );
    }

    const resolucao = await this.resolverAlvo(argumentos.alvo);

    if (!resolucao.ok) {
      return this.bloqueio(resolucao.motivo);
    }

    return operacao === 'descrever_schema'
      ? this.descrever(resolucao.valor, argumentos.tabela)
      : this.consultar(resolucao.valor, argumentos.sql);
  }

  private operacaoPedida(bruto: unknown): Operacao | null {
    if (bruto === undefined || bruto === null || bruto === '') {
      return 'consultar';
    }

    if (typeof bruto !== 'string') {
      return null;
    }

    const pedida = bruto.trim();

    return OPERACOES.includes(pedida as Operacao) ? (pedida as Operacao) : null;
  }

  private async resolverAlvo(bruto: unknown): Promise<ResolucaoAlvo> {
    const pedido = typeof bruto === 'string' ? bruto.trim() : '';

    if (!pedido) {
      return {
        ok: false,
        motivo: 'o argumento "alvo" é obrigatório e precisa ser texto',
      };
    }

    if (!this.config.escopos.bancos.includes(pedido)) {
      return {
        ok: false,
        motivo: `o alvo "${pedido}" não está em BANCO_ALVOS no .env desta instalação`,
      };
    }

    const cadastrados = await this.configuracao.alvosBanco();
    const alvo = cadastrados.find((item) => item.nome === pedido);

    if (!alvo) {
      return {
        ok: false,
        motivo: `o alvo "${pedido}" não está cadastrado e ativo em alvo_banco`,
      };
    }

    const schemas = schemasBemFormados(alvo.schemas ?? []);

    if (!schemas.ok) {
      return { ok: false, motivo: schemas.motivo };
    }

    const url = await this.configuracao.urlDoAlvo(alvo.nome);

    if (!url) {
      return {
        ok: false,
        motivo: `a URL do alvo "${pedido}" não pôde ser decifrada — recadastre o alvo`,
      };
    }

    return { ok: true, valor: { alvo, schemas: schemas.schemas, url } };
  }

  private async consultar(
    resolvido: AlvoResolvido,
    bruto: unknown,
  ): Promise<ResultadoCapacidade> {
    const veredicto = validarConsulta(bruto, {
      teto: TETO_DE_LINHAS_PADRAO,
      schemas: resolvido.schemas,
      colunasMascaradas: resolvido.alvo.colunasMascaradas ?? [],
    });

    if (!veredicto.ok) {
      return this.bloqueio(veredicto.motivo);
    }

    const execucao = await this.executor.consultar({
      url: resolvido.url,
      schemas: resolvido.schemas,
      sql: veredicto.sql,
      teto: veredicto.limite,
    });

    if (!execucao.ok) {
      return this.falha(resolvido, veredicto.sql, execucao.erro);
    }

    const formatada = formatarTabela(
      execucao.resposta.colunas,
      execucao.resposta.linhas,
      resolvido.alvo.colunasMascaradas ?? [],
    );

    const linhas = execucao.resposta.linhas.length;

    return this.resultado(
      resolvido,
      `banco://${resolvido.alvo.nome}/consulta`,
      `consulta em ${resolvido.alvo.nome}`,
      `${linhas} linha(s), limite ${veredicto.limite}${
        veredicto.limiteImposto ? ' imposto pelo Oráculo' : ''
      }`,
      formatada,
      `consulta em ${resolvido.alvo.nome}: ${linhas} linha(s)`,
      linhas,
      veredicto.sql,
    );
  }

  private async descrever(
    resolvido: AlvoResolvido,
    bruto: unknown,
  ): Promise<ResultadoCapacidade> {
    const tabela = typeof bruto === 'string' ? bruto.trim() : '';

    if (tabela && !NOME_DE_TABELA.test(tabela)) {
      return this.bloqueio(
        'o argumento "tabela" só aceita letras, números e sublinhado',
      );
    }

    const plano = `descrever schema ${resolvido.schemas.join(', ')}${
      tabela ? ` da tabela ${tabela}` : ''
    }`;

    const execucao = await this.executor.descrever({
      url: resolvido.url,
      schemas: resolvido.schemas,
      tabela: tabela || null,
    });

    if (!execucao.ok) {
      return this.falha(resolvido, plano, execucao.erro);
    }

    const formatada = formatarSchema(
      execucao.colunas,
      resolvido.alvo.colunasMascaradas ?? [],
    );

    return this.resultado(
      resolvido,
      `banco://${resolvido.alvo.nome}/schema`,
      `schema de ${resolvido.alvo.nome}`,
      `schemas ${resolvido.schemas.join(', ')}`,
      formatada,
      `schema de ${resolvido.alvo.nome}: ${execucao.colunas.length} coluna(s)`,
      execucao.colunas.length,
      plano,
    );
  }

  private resultado(
    resolvido: AlvoResolvido,
    caminho: string,
    titulo: string,
    meta: string,
    formatada: TabelaFormatada,
    metrica: string,
    volume: number,
    plano: string,
  ): ResultadoCapacidade {
    const retorno: RetornoFerramenta = {
      origem: {
        ferramenta: this.nome,
        tipo: 'banco',
        caminho,
        titulo,
        meta,
      },
      conteudo: this.sanitizar(formatada.texto),
      truncado: formatada.truncada,
    };

    return { retornos: [retorno], metrica, volume, plano };
  }

  private falha(
    resolvido: AlvoResolvido,
    plano: string,
    erro: string,
  ): ResultadoCapacidade {
    return {
      retornos: [
        {
          origem: {
            ferramenta: this.nome,
            tipo: 'banco',
            caminho: `banco://${resolvido.alvo.nome}`,
            titulo: `falha no alvo ${resolvido.alvo.nome}`,
            meta: 'a consulta não devolveu dado',
          },
          conteudo: this.sanitizar(erro),
        },
      ],
      metrica: `falha em ${resolvido.alvo.nome}`,
      volume: 0,
      plano,
    };
  }

  private sanitizar(bruto: string): string {
    return this.sanitizador.sanitizar(bruto).texto;
  }

  private bloqueio(motivo: string): ResultadoCapacidade {
    return { retornos: [], metrica: `bloqueado: ${motivo}`, volume: 0 };
  }
}
