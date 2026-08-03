import { resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OraculoConfig } from '../config/config.service';
import { PerfilCapacidade, StatusPerfilCapacidade } from '../database/entities';
import type {
  AlcancePerfil,
  CapacidadeDoPerfil,
  PedidoFerramenta,
  Politica,
  Veredito,
} from './tipos';

type AlvoCapacidade = 'conhecimento' | 'codigo' | 'estado' | 'banco';

interface DefinicaoCapacidade {
  alvo: AlvoCapacidade;
  sensivel: boolean;
}

const CATALOGO: Record<string, DefinicaoCapacidade> = {
  buscar_conhecimento: { alvo: 'conhecimento', sensivel: false },
  ler_documento: { alvo: 'conhecimento', sensivel: false },
  buscar_codigo: { alvo: 'codigo', sensivel: false },
  ler_arquivo: { alvo: 'codigo', sensivel: false },
  consultar_banco: { alvo: 'banco', sensivel: true },
  estado_servicos: { alvo: 'estado', sensivel: true },
};

const SQL_ABERTURA = /^\s*(?:select|with)\b/i;

const SQL_ESCRITA =
  /\b(?:insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|merge|into|comment|reindex|refresh|vacuum|call|lock|prepare|execute)\b/i;

const SQL_PERIGOSO =
  /\b(?:pg_read_file|pg_read_binary_file|pg_ls_dir|pg_sleep|pg_terminate_backend|nextval|setval|dblink|lo_import|lo_export|current_setting|pg_shadow|pg_authid)\b/i;

@Injectable()
export class PoliticaService {
  constructor(
    private readonly config: OraculoConfig,
    @InjectRepository(PerfilCapacidade)
    private readonly repositorio: Repository<PerfilCapacidade>,
  ) {}

  async carregarAlcance(perfilId: string): Promise<AlcancePerfil> {
    const linhas = await this.repositorio.find({
      where: { perfil: { id: perfilId } },
      relations: { perfil: true },
    });

    return {
      perfilId,
      perfil: linhas[0]?.perfil?.nome ?? '',
      capacidades: linhas.map((linha) => ({
        capacidade: linha.capacidade,
        status: linha.status,
        escopo: linha.escopo,
      })),
    };
  }

  avaliar(pedido: PedidoFerramenta): Veredito {
    const definicao = CATALOGO[pedido.capacidade];

    if (!definicao) {
      return this.negar(
        pedido,
        'capacidade_desconhecida',
        `capacidade "${pedido.capacidade}" nao existe no catalogo do Oraculo`,
      );
    }

    if (!this.ligada(definicao.alvo)) {
      return this.negar(
        pedido,
        'capacidade_desligada',
        `capacidade "${pedido.capacidade}" esta desligada nesta instancia`,
      );
    }

    const linha = pedido.alcance?.capacidades?.find(
      (item) =>
        item.capacidade === pedido.capacidade ||
        item.capacidade === definicao.alvo,
    );

    if (!linha) {
      return this.negar(
        pedido,
        'sem_permissao_explicita',
        `o perfil "${pedido.alcance?.perfil || 'desconhecido'}" nao tem "${pedido.capacidade}" na matriz de permissoes`,
      );
    }

    if (linha.status === StatusPerfilCapacidade.NEGADA) {
      return this.negar(
        pedido,
        'negada_no_perfil',
        `capacidade "${pedido.capacidade}" negada para o perfil "${pedido.alcance.perfil}"`,
      );
    }

    const argumentos = this.conferirArgumentos(pedido, definicao, linha);

    if (argumentos) {
      return argumentos;
    }

    if (linha.status === StatusPerfilCapacidade.APROVACAO) {
      return {
        capacidade: pedido.capacidade,
        decisao: 'exigir_aprovacao',
        politica: 'aprovacao_exigida_no_perfil',
        motivo: `a matriz do perfil "${pedido.alcance.perfil}" exige aprovacao para "${pedido.capacidade}"`,
      };
    }

    if (definicao.sensivel) {
      return {
        capacidade: pedido.capacidade,
        decisao: 'exigir_aprovacao',
        politica: 'capacidade_sensivel',
        motivo: `"${pedido.capacidade}" toca infraestrutura viva e nunca roda sem aprovacao humana`,
      };
    }

    return {
      capacidade: pedido.capacidade,
      decisao: 'permitir',
      politica: 'permitida',
      motivo: `capacidade permitida para o perfil "${pedido.alcance.perfil}" e dentro do escopo`,
    };
  }

  private conferirArgumentos(
    pedido: PedidoFerramenta,
    definicao: DefinicaoCapacidade,
    linha: CapacidadeDoPerfil,
  ): Veredito | null {
    const argumentos = pedido.argumentos ?? {};

    if (pedido.capacidade === 'buscar_conhecimento') {
      return this.exigirTexto(pedido, argumentos, 'consulta');
    }

    if (
      pedido.capacidade === 'ler_arquivo' ||
      pedido.capacidade === 'ler_documento'
    ) {
      return this.conferirCaminho(pedido, argumentos, definicao, linha);
    }

    if (pedido.capacidade === 'consultar_banco') {
      return this.conferirBanco(pedido, argumentos, linha);
    }

    if (pedido.capacidade === 'estado_servicos') {
      return this.conferirComando(pedido, argumentos, linha);
    }

    return null;
  }

  private conferirCaminho(
    pedido: PedidoFerramenta,
    argumentos: Record<string, unknown>,
    definicao: DefinicaoCapacidade,
    linha: CapacidadeDoPerfil,
  ): Veredito | null {
    const faltando = this.exigirTexto(pedido, argumentos, 'caminho');

    if (faltando) {
      return faltando;
    }

    const caminho = String(argumentos.caminho);

    if (caminho.includes('..') || !caminho.startsWith('/')) {
      return this.negar(
        pedido,
        'fora_de_escopo',
        'o caminho precisa ser absoluto e sem travessia de diretorio ("..")',
      );
    }

    if (this.negadoPorPadrao(caminho)) {
      return this.negar(
        pedido,
        'caminho_negado',
        `"${caminho}" casa com a lista de negacao do corpus`,
      );
    }

    const raizes = this.raizes(definicao.alvo, linha);

    if (raizes.length === 0) {
      return this.negar(
        pedido,
        'fora_de_escopo',
        'nenhuma raiz de leitura configurada para esta capacidade',
      );
    }

    if (!this.dentroDasRaizes(caminho, raizes)) {
      return this.negar(
        pedido,
        'fora_de_escopo',
        `"${caminho}" esta fora das raizes liberadas para o perfil`,
      );
    }

    return null;
  }

  private conferirBanco(
    pedido: PedidoFerramenta,
    argumentos: Record<string, unknown>,
    linha: CapacidadeDoPerfil,
  ): Veredito | null {
    const faltando =
      this.exigirTexto(pedido, argumentos, 'alvo') ??
      this.exigirTexto(pedido, argumentos, 'sql');

    if (faltando) {
      return faltando;
    }

    const alvo = String(argumentos.alvo);
    const permitidos = this.lista(linha, 'bancos', this.config.escopos.bancos);

    if (!permitidos.includes(alvo)) {
      return this.negar(
        pedido,
        'fora_de_escopo',
        `banco "${alvo}" nao esta na allowlist do perfil`,
      );
    }

    const sql = String(argumentos.sql);

    if (!this.somenteLeitura(sql)) {
      return this.negar(
        pedido,
        'escrita_no_banco',
        'o Oraculo so executa consulta de leitura, em uma unica instrucao',
      );
    }

    return null;
  }

  private conferirComando(
    pedido: PedidoFerramenta,
    argumentos: Record<string, unknown>,
    linha: CapacidadeDoPerfil,
  ): Veredito | null {
    const faltando = this.exigirTexto(pedido, argumentos, 'comando');

    if (faltando) {
      return faltando;
    }

    const comando = String(argumentos.comando).trim();
    const permitidos = this.lista(
      linha,
      'comandos',
      this.config.escopos.comandos,
    );

    if (!permitidos.includes(comando)) {
      return this.negar(
        pedido,
        'comando_fora_da_allowlist',
        `"${comando}" nao esta na allowlist de comandos — shell livre nunca e permitido`,
      );
    }

    return null;
  }

  private somenteLeitura(sql: string): boolean {
    const limpo = sql
      .replace(/--[^\n]*/g, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ');
    const instrucoes = limpo.split(';').filter((parte) => parte.trim());

    if (instrucoes.length !== 1) {
      return false;
    }

    return (
      SQL_ABERTURA.test(limpo) &&
      !SQL_ESCRITA.test(limpo) &&
      !SQL_PERIGOSO.test(limpo)
    );
  }

  private exigirTexto(
    pedido: PedidoFerramenta,
    argumentos: Record<string, unknown>,
    chave: string,
  ): Veredito | null {
    const valor = argumentos[chave];

    if (typeof valor !== 'string' || !valor.trim()) {
      return this.negar(
        pedido,
        'argumento_invalido',
        `o argumento "${chave}" e obrigatorio e precisa ser texto`,
      );
    }

    return null;
  }

  private ligada(alvo: AlvoCapacidade): boolean {
    return this.config.capacidades[alvo];
  }

  private raizes(alvo: AlvoCapacidade, linha: CapacidadeDoPerfil): string[] {
    if (alvo === 'codigo') {
      return this.lista(linha, 'repositorios', this.config.escopos.repos);
    }

    return this.lista(linha, 'fontes', this.config.corpus.fontes);
  }

  private lista(
    linha: CapacidadeDoPerfil,
    chave: string,
    padrao: string[],
  ): string[] {
    const bruto = linha.escopo?.[chave];

    if (Array.isArray(bruto)) {
      return bruto.filter((item): item is string => typeof item === 'string');
    }

    return padrao;
  }

  private dentroDasRaizes(caminho: string, raizes: string[]): boolean {
    const alvo = resolve(caminho);

    return raizes.some((raiz) => {
      const base = resolve(raiz);

      return alvo === base || alvo.startsWith(`${base}/`);
    });
  }

  private negadoPorPadrao(caminho: string): boolean {
    const partes = caminho.split('/').filter(Boolean);

    return this.config.corpus.negados.some((padrao) => {
      const expressao = this.compilarGlob(padrao);

      return (
        expressao.test(caminho) || partes.some((parte) => expressao.test(parte))
      );
    });
  }

  private compilarGlob(padrao: string): RegExp {
    const corpo = padrao
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*|\*|\?/g, (simbolo) =>
        simbolo === '**' ? '.*' : simbolo === '*' ? '[^/]*' : '.',
      );

    return new RegExp(`^${corpo}$`);
  }

  private negar(
    pedido: PedidoFerramenta,
    politica: Politica,
    motivo: string,
  ): Veredito {
    return {
      capacidade: pedido.capacidade,
      decisao: 'bloquear',
      politica,
      motivo,
    };
  }
}
