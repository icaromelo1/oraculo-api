import { stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import {
  AlvoBanco,
  CapacidadeInstalacao,
  Documento,
  FonteConhecimento,
  Modulo,
  NomeCapacidadeInstalacao,
  Persona,
  ProvedorModelo,
  ServicoObservavel,
  TipoProvedorModelo,
  Usuario,
} from '../database/entities';
import { validarEnderecoDeProvedor } from '../providers/endereco-seguro';
import {
  raizesComConteudo,
  type RaizResolvida,
} from '../capabilities/codigo/seguranca';
import { casaAlgumPadrao } from '../corpus/denylist';
import {
  ErroDialetoInvalido,
  interpretarDescritor,
} from '../providers/dialeto';
import { SecurityService } from '../security/security.service';
import { CifraService, ResumoChave, ResumoConexao } from './cifra.service';
import { OraculoConfig } from './config.service';
import { TIPOS_DE_PROVEDOR } from './env.schema';
import {
  CaminhoNaRaiz,
  raizesPermitidas,
  resolverCaminhoNasRaizes,
} from './raiz-permitida';

export type NomeCapacidade = `${NomeCapacidadeInstalacao}`;

const CAPACIDADES: NomeCapacidade[] = [
  'conhecimento',
  'codigo',
  'estado',
  'banco',
];

const DIALETOS = ['auto', 'claude', 'agy'];

const VARIAVEL_DO_ENV: Record<NomeCapacidade, string> = {
  conhecimento: 'CAP_CONHECIMENTO',
  codigo: 'CAP_CODIGO',
  estado: 'CAP_ESTADO',
  banco: 'CAP_BANCO',
};

export interface CapacidadeEfetiva {
  capacidade: NomeCapacidade;
  ligada: boolean;
  tetoDoEnv: boolean;
  motivoIndisponivel?: string;
  aviso?: string;
}

export interface FonteEfetiva {
  id: string | null;
  caminho: string;
  rotulo: string;
  origem: 'env' | 'banco';
  removivel: boolean;
}

export interface AlvoBancoResumido {
  id: string;
  nome: string;
  schemas: string[];
  colunasMascaradas: string[];
  ativo: boolean;
  criadoEm: Date;
  conexao: ResumoConexao;
}

export interface ServicoResumido {
  id: string;
  nome: string;
  rotulo: string;
  ativo: boolean;
  criadoEm: Date;
}

export interface NovoAlvoBanco {
  nome: string;
  url: string;
  schemas?: string[];
  colunasMascaradas?: string[];
}

export interface NovoServico {
  nome: string;
  rotulo: string;
}

export interface NovaFonte {
  caminho: string;
  rotulo?: string;
}

export interface ProvedorResumido {
  id: string;
  nome: string;
  tipo: TipoProvedorModelo;
  baseUrl: string | null;
  modelo: string | null;
  comando: string | null;
  dialeto: string | null;
  cabecalhosExtras: string[];
  parametros: Record<string, unknown> | null;
  ativo: boolean;
  criadoEm: Date;
  chave: ResumoChave;
  permitidoPeloEnv: boolean;
  motivoIndisponivel?: string;
}

export interface ProvedorAtivo {
  id: string;
  nome: string;
  tipo: TipoProvedorModelo;
  baseUrl: string | null;
  modelo: string | null;
  chave: string | null;
  cabecalhosExtras: Record<string, string> | null;
  parametros: Record<string, unknown> | null;
  comando: string | null;
  dialeto: string | null;
}

export interface NovoProvedor {
  nome: string;
  tipo: string;
  baseUrl?: string;
  modelo?: string;
  chave?: string;
  cabecalhosExtras?: Record<string, string>;
  parametros?: Record<string, unknown>;
  comando?: string;
  dialeto?: string;
}

export interface ModuloResumido {
  id: string;
  nome: string;
  descricao: string;
  especialistaDocumentoId: string | null;
  documentos: number;
  criadoEm: Date;
}

export interface NovoModulo {
  nome: string;
  descricao: string;
}

export interface EdicaoDeModulo {
  nome?: string;
  descricao?: string;
}

export interface MudancaDeModulo {
  movidos: number;
  moduloId: string | null;
}

export interface DescricaoDeDocumento {
  id: string;
  descricao: string | null;
}

export interface ModuloIdentificado {
  id: string;
  nome: string;
}

export const TETO_DO_MAPA_DE_MODULOS = 800;

const TETO_DA_LINHA_DO_MAPA = 200;
const TETO_DA_DESCRICAO_NO_MAPA = 120;

interface ContagemPorModulo {
  porModulo: Map<string, number>;
  semModulo: number;
}

interface Instantaneo {
  capacidades: CapacidadeEfetiva[];
  fontes: FonteEfetiva[];
  alvos: AlvoBanco[];
  servicos: ServicoObservavel[];
  provedores: ProvedorModelo[];
  modulos: Modulo[];
  persona: string | null;
}

@Injectable()
export class ConfiguracaoService implements OnModuleInit {
  private readonly logger = new Logger(ConfiguracaoService.name);

  private instantaneo: Instantaneo | null = null;
  private valido = false;
  private carregamento: Promise<Instantaneo> | null = null;

  constructor(
    private readonly config: OraculoConfig,
    private readonly cifra: CifraService,
    private readonly seguranca: SecurityService,
    @InjectRepository(CapacidadeInstalacao)
    private readonly capacidades: Repository<CapacidadeInstalacao>,
    @InjectRepository(FonteConhecimento)
    private readonly fontes: Repository<FonteConhecimento>,
    @InjectRepository(AlvoBanco)
    private readonly alvos: Repository<AlvoBanco>,
    @InjectRepository(ServicoObservavel)
    private readonly servicos: Repository<ServicoObservavel>,
    @InjectRepository(ProvedorModelo)
    private readonly modelos: Repository<ProvedorModelo>,
    @InjectRepository(Modulo)
    private readonly tabelaDeModulos: Repository<Modulo>,
    @InjectRepository(Documento)
    private readonly documentos: Repository<Documento>,
    @InjectRepository(Persona)
    private readonly personas: Repository<Persona>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.estado();
    } catch (erro) {
      this.logger.warn(
        `configuração dinâmica indisponível no boot, valendo só o .env: ${
          erro instanceof Error ? erro.message : String(erro)
        }`,
      );
    }
  }

  async capacidadesEfetivas(): Promise<CapacidadeEfetiva[]> {
    return (await this.estado()).capacidades;
  }

  capacidadeLigada(nome: NomeCapacidade): boolean {
    const carregada = this.instantaneo?.capacidades.find(
      (item) => item.capacidade === nome,
    );

    return carregada ? carregada.ligada : this.teto(nome);
  }

  async fontesEfetivas(): Promise<FonteEfetiva[]> {
    return (await this.estado()).fontes;
  }

  raizesDeLeitura(): RaizResolvida[] {
    return raizesPermitidas(this.config);
  }

  async resolverCaminhoDeFonte(caminho: string): Promise<CaminhoNaRaiz> {
    return resolverCaminhoNasRaizes(caminho, this.raizesDeLeitura());
  }

  async alvosBanco(): Promise<AlvoBancoResumido[]> {
    if (!(await this.ligadaEfetiva('banco'))) {
      return [];
    }

    return (await this.estado()).alvos
      .filter((alvo) => alvo.ativo)
      .map((alvo) => this.resumirAlvo(alvo));
  }

  async servicosObservaveis(): Promise<ServicoResumido[]> {
    if (!(await this.ligadaEfetiva('estado'))) {
      return [];
    }

    return (await this.estado()).servicos
      .filter((servico) => servico.ativo)
      .map((servico) => this.resumirServico(servico));
  }

  async urlDoAlvo(nome: string): Promise<string | null> {
    const alvo = (await this.estado()).alvos.find(
      (item) => item.nome === nome && item.ativo,
    );

    if (!alvo || !(await this.ligadaEfetiva('banco'))) {
      return null;
    }

    return this.cifra.decifrar(alvo.url);
  }

  async definirCapacidade(
    nome: string,
    ligada: boolean,
    usuarioId?: string | null,
  ): Promise<CapacidadeEfetiva> {
    const capacidade = this.exigirCapacidadeConhecida(nome);

    if (ligada && !this.teto(capacidade)) {
      throw new ForbiddenException(
        `a capacidade "${capacidade}" está desligada por ${VARIAVEL_DO_ENV[capacidade]}=off no .env desta instalação — o banco só recorta dentro do que o .env permite, nunca amplia`,
      );
    }

    const anterior = (await this.capacidadesEfetivas()).find(
      (item) => item.capacidade === capacidade,
    );

    const existente = await this.capacidades.findOne({
      where: { capacidade: capacidade as NomeCapacidadeInstalacao },
    });

    await this.capacidades.save(
      this.capacidades.create({
        ...(existente ? { id: existente.id } : {}),
        capacidade: capacidade as NomeCapacidadeInstalacao,
        ligada,
        atualizadaPor: this.referenciaUsuario(usuarioId),
      }),
    );

    await this.invalidar();

    await this.auditar(
      usuarioId,
      'ambiente.capacidade',
      { capacidade, ligada },
      `capacidade "${capacidade}" passou de ${this.rotuloLigada(anterior?.ligada)} para ${this.rotuloLigada(ligada)}`,
    );

    const atual = (await this.capacidadesEfetivas()).find(
      (item) => item.capacidade === capacidade,
    );

    return atual as CapacidadeEfetiva;
  }

  async criarFonte(
    nova: NovaFonte,
    usuarioId?: string | null,
  ): Promise<FonteEfetiva> {
    this.exigirTeto('conhecimento');

    const resolvido = await this.resolverCaminhoDeFonte(nova.caminho);

    if (!resolvido.existe || !(await this.ehDiretorio(resolvido.real))) {
      throw new BadRequestException(
        `"${nova.caminho}" não é uma pasta legível nesta instalação`,
      );
    }

    const nome = basename(resolvido.real);

    if (casaAlgumPadrao(nome, this.config.corpus.negados)) {
      throw new BadRequestException(
        `a pasta "${nome}" casa com a denylist do corpus — nenhum arquivo dela seria indexado`,
      );
    }

    const jaExiste = await this.fontes.findOne({
      where: { caminho: resolvido.real },
    });

    if (jaExiste) {
      throw new ConflictException(
        `a pasta "${resolvido.real}" já está cadastrada como fonte`,
      );
    }

    const salva = await this.fontes.save(
      this.fontes.create({
        caminho: resolvido.real,
        rotulo: nova.rotulo?.trim() || nome,
        ativa: true,
        criadaPor: this.referenciaUsuario(usuarioId),
      }),
    );

    await this.invalidar();

    await this.auditar(
      usuarioId,
      'ambiente.fonte.criar',
      { caminho: salva.caminho, rotulo: salva.rotulo },
      `fonte de conhecimento "${salva.rotulo}" cadastrada em ${salva.caminho} (antes: inexistente)`,
    );

    return {
      id: salva.id,
      caminho: salva.caminho,
      rotulo: salva.rotulo,
      origem: 'banco',
      removivel: true,
    };
  }

  async removerFonte(id: string, usuarioId?: string | null): Promise<void> {
    const existente = await this.fontes.findOne({ where: { id } });

    if (!existente) {
      throw new NotFoundException(`fonte de conhecimento "${id}" não existe`);
    }

    await this.fontes.delete({ id });

    await this.invalidar();

    await this.auditar(
      usuarioId,
      'ambiente.fonte.remover',
      { id, caminho: existente.caminho },
      `fonte de conhecimento "${existente.rotulo}" removida (antes: ${existente.caminho})`,
    );
  }

  async criarServico(
    novo: NovoServico,
    usuarioId?: string | null,
  ): Promise<ServicoResumido> {
    this.exigirTeto('estado');

    const salvo = await this.servicos.save(
      this.servicos.create({
        nome: novo.nome.trim(),
        rotulo: novo.rotulo.trim(),
        ativo: true,
      }),
    );

    await this.invalidar();

    await this.auditar(
      usuarioId,
      'ambiente.servico.criar',
      { nome: salvo.nome, rotulo: salvo.rotulo },
      `serviço observável "${salvo.nome}" criado (antes: inexistente)`,
    );

    return this.resumirServico(salvo);
  }

  async removerServico(id: string, usuarioId?: string | null): Promise<void> {
    const existente = await this.servicos.findOne({ where: { id } });

    if (!existente) {
      throw new NotFoundException(`serviço observável "${id}" não existe`);
    }

    await this.servicos.delete({ id });

    await this.invalidar();

    await this.auditar(
      usuarioId,
      'ambiente.servico.remover',
      { id, nome: existente.nome },
      `serviço observável "${existente.nome}" removido (antes: ${
        existente.ativo ? 'ativo' : 'inativo'
      })`,
    );
  }

  async criarAlvoBanco(
    novo: NovoAlvoBanco,
    usuarioId?: string | null,
  ): Promise<AlvoBancoResumido> {
    this.exigirTeto('banco');

    const nome = novo.nome.trim();
    const permitidos = this.config.escopos.bancos;

    if (!permitidos.includes(nome)) {
      throw new ForbiddenException(
        `o alvo "${nome}" não está em BANCO_ALVOS no .env desta instalação — o banco só recorta dentro do que o .env permite, nunca amplia`,
      );
    }

    const salvo = await this.alvos.save(
      this.alvos.create({
        nome,
        url: this.cifra.cifrar(novo.url.trim()),
        schemas: novo.schemas ?? [],
        colunasMascaradas: novo.colunasMascaradas ?? [],
        ativo: true,
      }),
    );

    await this.invalidar();

    await this.auditar(
      usuarioId,
      'ambiente.alvo-banco.criar',
      {
        nome: salvo.nome,
        schemas: salvo.schemas,
        colunasMascaradas: salvo.colunasMascaradas,
      },
      `alvo de banco "${salvo.nome}" criado (antes: inexistente)`,
    );

    return this.resumirAlvo(salvo);
  }

  async removerAlvoBanco(id: string, usuarioId?: string | null): Promise<void> {
    const existente = await this.alvos.findOne({ where: { id } });

    if (!existente) {
      throw new NotFoundException(`alvo de banco "${id}" não existe`);
    }

    await this.alvos.delete({ id });

    await this.invalidar();

    await this.auditar(
      usuarioId,
      'ambiente.alvo-banco.remover',
      { id, nome: existente.nome },
      `alvo de banco "${existente.nome}" removido (antes: ${
        existente.ativo ? 'ativo' : 'inativo'
      })`,
    );
  }

  async provedores(): Promise<ProvedorResumido[]> {
    return (await this.estado()).provedores
      .slice()
      .sort((um, outro) => um.nome.localeCompare(outro.nome))
      .map((provedor) => this.resumirProvedor(provedor));
  }

  async provedorAtivo(): Promise<ProvedorAtivo | null> {
    return this.escolherAtivo((await this.estado()).provedores);
  }

  provedorAtivoSincrono(): ProvedorAtivo | null {
    if (!this.instantaneo) {
      return null;
    }

    return this.escolherAtivo(this.instantaneo.provedores);
  }

  async criarProvedor(
    novo: NovoProvedor,
    usuarioId?: string | null,
  ): Promise<ProvedorResumido> {
    const tipo = this.exigirTipoPermitido(novo.tipo);
    const nome = novo.nome.trim();

    if (!nome) {
      throw new BadRequestException('o provedor precisa de um nome');
    }

    const jaExiste = await this.modelos.findOne({ where: { nome } });

    if (jaExiste) {
      throw new ConflictException(`já existe um provedor chamado "${nome}"`);
    }

    const baseUrl = this.validarBaseUrl(novo.baseUrl);
    const modelo = novo.modelo?.trim() || null;
    const comando = novo.comando?.trim() || null;
    const dialeto = this.validarDialeto(novo.dialeto);

    this.exigirCamposDoTipo(tipo, {
      baseUrl,
      modelo,
      comando,
      chave: novo.chave,
    });

    const salvo = await this.modelos.save(
      this.modelos.create({
        nome,
        tipo,
        baseUrl,
        modelo,
        comando,
        dialeto,
        chaveCifrada: novo.chave ? this.cifra.cifrar(novo.chave) : null,
        cabecalhosExtras: novo.cabecalhosExtras ?? null,
        parametros: novo.parametros ?? null,
        ativo: false,
        criadoPor: this.referenciaUsuario(usuarioId),
      }),
    );

    await this.invalidar();

    await this.auditar(
      usuarioId,
      'ambiente.provedor.criar',
      { nome: salvo.nome, tipo: salvo.tipo, modelo: salvo.modelo, baseUrl },
      `provedor de modelo "${salvo.nome}" (${salvo.tipo}) cadastrado, inativo (antes: inexistente)`,
    );

    return this.resumirProvedor(salvo);
  }

  async ativarProvedor(
    id: string,
    usuarioId?: string | null,
  ): Promise<ProvedorResumido> {
    const alvo = await this.modelos.findOne({ where: { id } });

    if (!alvo) {
      throw new NotFoundException(`provedor de modelo "${id}" não existe`);
    }

    this.exigirTipoPermitido(alvo.tipo);

    const anterior = (await this.estado()).provedores.find(
      (provedor) => provedor.ativo,
    );

    await this.modelos.manager.transaction(async (gerenciador) => {
      await gerenciador.update(
        ProvedorModelo,
        { ativo: true },
        { ativo: false },
      );
      await gerenciador.update(ProvedorModelo, { id }, { ativo: true });
    });

    await this.invalidar();

    await this.auditar(
      usuarioId,
      'ambiente.provedor.ativar',
      { id, nome: alvo.nome, tipo: alvo.tipo },
      `provedor de modelo ativo passou de ${
        anterior ? `"${anterior.nome}"` : 'o do .env'
      } para "${alvo.nome}" (${alvo.tipo})`,
    );

    const atual = (await this.estado()).provedores.find(
      (provedor) => provedor.id === id,
    );

    return this.resumirProvedor(atual ?? { ...alvo, ativo: true });
  }

  async removerProvedor(id: string, usuarioId?: string | null): Promise<void> {
    const existente = await this.modelos.findOne({ where: { id } });

    if (!existente) {
      throw new NotFoundException(`provedor de modelo "${id}" não existe`);
    }

    await this.modelos.delete({ id });

    await this.invalidar();

    await this.auditar(
      usuarioId,
      'ambiente.provedor.remover',
      { id, nome: existente.nome, tipo: existente.tipo },
      `provedor de modelo "${existente.nome}" removido (antes: ${
        existente.ativo ? 'ativo' : 'inativo'
      })`,
    );
  }

  async modulos(): Promise<ModuloResumido[]> {
    const [instantaneo, contagem] = await Promise.all([
      this.estado(),
      this.contarDocumentosPorModulo(),
    ]);

    return instantaneo.modulos
      .slice()
      .sort((um, outro) => um.nome.localeCompare(outro.nome))
      .map((modulo) =>
        this.resumirModulo(modulo, contagem.porModulo.get(modulo.id) ?? 0),
      );
  }

  async criarModulo(
    novo: NovoModulo,
    usuarioId?: string | null,
  ): Promise<ModuloResumido> {
    const nome = this.exigirNomeDeModulo(novo.nome);
    const descricao = this.exigirDescricaoDeModulo(novo.descricao);

    await this.exigirNomeLivre(nome);

    const salvo = await this.tabelaDeModulos.save(
      this.tabelaDeModulos.create({
        nome,
        descricao,
        especialistaDocumentoId: null,
        criadoPor: this.referenciaUsuario(usuarioId),
      }),
    );

    await this.invalidar();

    await this.auditar(
      usuarioId,
      'ambiente.modulo.criar',
      { id: salvo.id, nome, descricao },
      `módulo "${nome}" criado (antes: inexistente)`,
    );

    return this.resumirModulo(salvo, 0);
  }

  async atualizarModulo(
    id: string,
    edicao: EdicaoDeModulo,
    usuarioId?: string | null,
  ): Promise<ModuloResumido> {
    const existente = await this.exigirModulo(id);

    const nome =
      edicao.nome === undefined
        ? existente.nome
        : this.exigirNomeDeModulo(edicao.nome);
    const descricao =
      edicao.descricao === undefined
        ? this.exigirDescricaoDeModulo(existente.descricao)
        : this.exigirDescricaoDeModulo(edicao.descricao);

    if (nome !== existente.nome) {
      await this.exigirNomeLivre(nome);
    }

    await this.tabelaDeModulos.update({ id }, { nome, descricao });

    await this.invalidar();

    await this.auditar(
      usuarioId,
      'ambiente.modulo.atualizar',
      { id, nome, descricao },
      `módulo "${nome}" atualizado (antes: "${existente.nome}" — ${existente.descricao})`,
    );

    const contagem = await this.contarDocumentosPorModulo();

    return this.resumirModulo(
      { ...existente, nome, descricao },
      contagem.porModulo.get(id) ?? 0,
    );
  }

  async removerModulo(id: string, usuarioId?: string | null): Promise<void> {
    const existente = await this.exigirModulo(id);
    const contagem = await this.contarDocumentosPorModulo();
    const desassociados = contagem.porModulo.get(id) ?? 0;

    await this.tabelaDeModulos.manager.transaction(async (gerenciador) => {
      await gerenciador.update(Documento, { moduloId: id }, { moduloId: null });
      await gerenciador.delete(Modulo, { id });
    });

    await this.invalidar();

    await this.auditar(
      usuarioId,
      'ambiente.modulo.remover',
      { id, nome: existente.nome, desassociados },
      `módulo "${existente.nome}" removido, deixando ${desassociados} ${this.plural(
        desassociados,
      )} sem módulo (antes: ${existente.descricao})`,
    );
  }

  async definirEspecialista(
    moduloId: string,
    documentoId: string | null,
    usuarioId?: string | null,
  ): Promise<ModuloResumido> {
    const modulo = await this.exigirModulo(moduloId);
    const documento = documentoId
      ? await this.exigirDocumento(documentoId)
      : null;

    if (documento && documento.moduloId !== moduloId) {
      throw new BadRequestException(
        `"${documento.titulo}" não pertence ao módulo "${modulo.nome}" — mova o documento para o módulo antes de torná-lo a capa`,
      );
    }

    await this.tabelaDeModulos.update(
      { id: moduloId },
      { especialistaDocumentoId: documento?.id ?? null },
    );

    await this.invalidar();

    await this.auditar(
      usuarioId,
      'ambiente.modulo.especialista',
      { id: moduloId, documentoId: documento?.id ?? null },
      `documento-capa do módulo "${modulo.nome}" passou de ${
        modulo.especialistaDocumentoId ?? 'nenhum'
      } para ${documento ? `"${documento.titulo}"` : 'nenhum'}`,
    );

    const contagem = await this.contarDocumentosPorModulo();

    return this.resumirModulo(
      { ...modulo, especialistaDocumentoId: documento?.id ?? null },
      contagem.porModulo.get(moduloId) ?? 0,
    );
  }

  async moverDocumentos(
    ids: string[],
    moduloId: string | null,
    usuarioId?: string | null,
  ): Promise<MudancaDeModulo> {
    const alvos = [
      ...new Set(
        (ids ?? []).map((item) => String(item).trim()).filter(Boolean),
      ),
    ];

    if (alvos.length === 0) {
      throw new BadRequestException(
        'informe ao menos um documento para mover de módulo',
      );
    }

    const modulo = moduloId ? await this.exigirModulo(moduloId) : null;

    const resultado = await this.documentos.update(
      { id: In(alvos) },
      { moduloId: modulo?.id ?? null },
    );

    await this.tabelaDeModulos.update(
      modulo
        ? { especialistaDocumentoId: In(alvos), id: Not(modulo.id) }
        : { especialistaDocumentoId: In(alvos) },
      { especialistaDocumentoId: null },
    );

    await this.invalidar();

    await this.auditar(
      usuarioId,
      'ambiente.modulo.mover',
      { documentos: alvos, moduloId: modulo?.id ?? null },
      `módulo de ${alvos.length} ${this.plural(alvos.length)} passou para ${
        modulo ? `"${modulo.nome}"` : 'nenhum'
      }`,
    );

    return {
      movidos: resultado.affected ?? 0,
      moduloId: modulo?.id ?? null,
    };
  }

  async descreverDocumento(
    id: string,
    descricao: string,
    usuarioId?: string | null,
  ): Promise<DescricaoDeDocumento> {
    const documento = await this.exigirDocumento(id);
    const nova = typeof descricao === 'string' ? descricao.trim() : '';

    await this.documentos.update(
      { id: documento.id },
      { descricao: nova || null },
    );

    await this.invalidar();

    await this.auditar(
      usuarioId,
      'ambiente.documento.descrever',
      { id: documento.id, descricao: nova || null },
      `descrição do documento "${documento.titulo}" passou de ${
        documento.descricao ? `"${documento.descricao}"` : 'vazia'
      } para ${nova ? `"${nova}"` : 'vazia'}`,
    );

    return { id: documento.id, descricao: nova || null };
  }

  async persona(): Promise<string | null> {
    return (await this.estado()).persona;
  }

  async definirPersona(
    texto: string,
    usuarioId?: string | null,
  ): Promise<string | null> {
    const nova = typeof texto === 'string' ? texto.trim() : '';
    const anterior = (await this.estado()).persona;
    const [existente] = await this.personas.find();

    await this.personas.save(
      this.personas.create({
        ...(existente ? { id: existente.id } : {}),
        texto: nova,
        atualizadaPor: this.referenciaUsuario(usuarioId),
      }),
    );

    await this.invalidar();

    await this.auditar(
      usuarioId,
      'ambiente.persona.definir',
      { caracteres: nova.length },
      `persona da instalação passou de ${
        anterior ? `${anterior.length} caractere(s)` : 'a do código'
      } para ${nova ? `${nova.length} caractere(s)` : 'a do código'}`,
    );

    return (await this.estado()).persona;
  }

  async identificarModulo(nome: string): Promise<ModuloIdentificado | null> {
    const alvo = this.chaveDeModulo(nome);

    if (!alvo) {
      return null;
    }

    const achado = (await this.estado()).modulos.find(
      (modulo) => this.chaveDeModulo(modulo.nome) === alvo,
    );

    return achado ? { id: achado.id, nome: achado.nome } : null;
  }

  private chaveDeModulo(bruto: string): string {
    return String(bruto).replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');
  }

  async mapaDeModulos(): Promise<string> {
    const [instantaneo, contagem] = await Promise.all([
      this.estado(),
      this.contarDocumentosPorModulo(),
    ]);

    const povoados = instantaneo.modulos
      .map((modulo) => ({
        modulo,
        total: contagem.porModulo.get(modulo.id) ?? 0,
      }))
      .filter((item) => item.total > 0)
      .sort(
        (um, outro) =>
          outro.total - um.total ||
          um.modulo.nome.localeCompare(outro.modulo.nome),
      );

    const rodape =
      contagem.semModulo > 0
        ? `- sem modulo: ${contagem.semModulo} ${this.plural(contagem.semModulo)}`
        : '';

    const teto = TETO_DO_MAPA_DE_MODULOS - (rodape ? rodape.length + 1 : 0);
    const linhas: string[] = [];
    let tamanho = 0;

    for (const item of povoados) {
      const linha = this.linhaDoMapa(item.modulo, item.total);
      const custo = linhas.length === 0 ? linha.length : linha.length + 1;

      if (tamanho + custo > teto) break;

      linhas.push(linha);
      tamanho += custo;
    }

    if (rodape) {
      linhas.push(rodape);
    }

    return linhas.join('\n');
  }

  private linhaDoMapa(modulo: Modulo, total: number): string {
    const descricao = this.encurtar(
      modulo.descricao,
      TETO_DA_DESCRICAO_NO_MAPA,
    );

    return this.encurtar(
      `- ${modulo.nome}: ${descricao} (${total} ${this.plural(total)})`,
      TETO_DA_LINHA_DO_MAPA,
    );
  }

  private encurtar(texto: string, teto: number): string {
    const limpo = String(texto ?? '')
      .replace(/\s+/g, ' ')
      .trim();

    return limpo.length <= teto
      ? limpo
      : `${limpo.slice(0, teto - 1).trimEnd()}…`;
  }

  private plural(total: number): string {
    return total === 1 ? 'documento' : 'documentos';
  }

  private resumirModulo(modulo: Modulo, documentos: number): ModuloResumido {
    return {
      id: modulo.id,
      nome: modulo.nome,
      descricao: modulo.descricao,
      especialistaDocumentoId: modulo.especialistaDocumentoId ?? null,
      documentos,
      criadoEm: modulo.criadoEm,
    };
  }

  private exigirNomeDeModulo(bruto: unknown): string {
    const nome = typeof bruto === 'string' ? bruto.trim() : '';

    if (!nome) {
      throw new BadRequestException('o módulo precisa de um nome');
    }

    return nome;
  }

  private exigirDescricaoDeModulo(bruta: unknown): string {
    const descricao = typeof bruta === 'string' ? bruta.trim() : '';

    if (!descricao) {
      throw new BadRequestException(
        'o módulo precisa de uma descrição — é ela que diz ao modelo o que existe ali dentro, e um módulo sem descrição não entra no mapa',
      );
    }

    return descricao;
  }

  private async exigirNomeLivre(nome: string): Promise<void> {
    const jaExiste = await this.tabelaDeModulos.findOne({ where: { nome } });

    if (jaExiste) {
      throw new ConflictException(`já existe um módulo chamado "${nome}"`);
    }
  }

  private async exigirModulo(id: string): Promise<Modulo> {
    const modulo = await this.tabelaDeModulos.findOne({ where: { id } });

    if (!modulo) {
      throw new NotFoundException(`módulo "${id}" não existe`);
    }

    return modulo;
  }

  private async exigirDocumento(id: string): Promise<Documento> {
    const documento = await this.documentos.findOne({ where: { id } });

    if (!documento) {
      throw new NotFoundException(`documento "${id}" não está indexado`);
    }

    return documento;
  }

  private async contarDocumentosPorModulo(): Promise<ContagemPorModulo> {
    const linhas = await this.documentos
      .createQueryBuilder('documento')
      .select('documento.moduloId', 'moduloId')
      .addSelect('COUNT(*)', 'total')
      .groupBy('documento.moduloId')
      .getRawMany<{ moduloId: string | null; total: number | string }>();

    const porModulo = new Map<string, number>();
    let semModulo = 0;

    for (const linha of linhas) {
      const total = Number(linha.total);

      if (linha.moduloId) {
        porModulo.set(linha.moduloId, total);
        continue;
      }

      semModulo += total;
    }

    return { porModulo, semModulo };
  }

  private escolherAtivo(provedores: ProvedorModelo[]): ProvedorAtivo | null {
    const ativo = provedores
      .slice()
      .sort((um, outro) => um.nome.localeCompare(outro.nome))
      .find((provedor) => provedor.ativo && this.tipoPermitido(provedor.tipo));

    if (!ativo) {
      return null;
    }

    return this.descreverProvedor(ativo);
  }

  private descreverProvedor(provedor: ProvedorModelo): ProvedorAtivo {
    return {
      id: provedor.id,
      nome: provedor.nome,
      tipo: provedor.tipo,
      baseUrl: provedor.baseUrl,
      modelo: provedor.modelo,
      chave: provedor.chaveCifrada
        ? this.cifra.decifrar(provedor.chaveCifrada)
        : null,
      cabecalhosExtras: provedor.cabecalhosExtras,
      parametros: provedor.parametros,
      comando: provedor.comando,
      dialeto: provedor.dialeto,
    };
  }

  tipoDeProvedorPermitido(tipo: string): boolean {
    return this.tipoPermitido(tipo as TipoProvedorModelo);
  }

  private tipoPermitido(tipo: TipoProvedorModelo): boolean {
    return this.config.provedoresPermitidos.includes(tipo);
  }

  private exigirTipoPermitido(bruto: string): TipoProvedorModelo {
    const tipo = String(bruto).trim() as TipoProvedorModelo;

    if (!TIPOS_DE_PROVEDOR.includes(tipo)) {
      throw new BadRequestException(
        `tipo de provedor "${bruto}" não existe — os conhecidos são ${TIPOS_DE_PROVEDOR.join(', ')}`,
      );
    }

    if (!this.tipoPermitido(tipo)) {
      throw new ForbiddenException(
        `o provedor do tipo "${tipo}" está fora de PROVEDORES_PERMITIDOS no .env desta instalação — o banco só recorta dentro do que o .env permite, nunca amplia`,
      );
    }

    return tipo;
  }

  private validarBaseUrl(bruto?: string): string | null {
    const informado = bruto?.trim();

    if (!informado) {
      return null;
    }

    const veredicto = validarEnderecoDeProvedor(informado);

    if (!veredicto.aprovado) {
      throw new BadRequestException(veredicto.motivo);
    }

    return veredicto.url;
  }

  private validarDialeto(bruto?: string): string | null {
    const informado = bruto?.trim();

    if (!informado) {
      return null;
    }

    if (DIALETOS.includes(informado)) {
      return informado;
    }

    try {
      interpretarDescritor(informado);
    } catch (erro) {
      throw new BadRequestException(
        erro instanceof ErroDialetoInvalido
          ? erro.message
          : `dialeto "${informado}" não é um preset conhecido (${DIALETOS.join(', ')}) nem um descritor JSON válido`,
      );
    }

    return informado;
  }

  private exigirCamposDoTipo(
    tipo: TipoProvedorModelo,
    campos: {
      baseUrl: string | null;
      modelo: string | null;
      comando: string | null;
      chave?: string;
    },
  ): void {
    if (tipo === TipoProvedorModelo.OPENAI_COMPAT) {
      if (!campos.baseUrl || !campos.modelo) {
        throw new BadRequestException(
          'um provedor openai-compat exige baseUrl e modelo',
        );
      }

      return;
    }

    if (tipo === TipoProvedorModelo.ANTHROPIC) {
      if (!campos.chave) {
        throw new BadRequestException('um provedor anthropic exige a chave');
      }

      return;
    }

    if (!campos.comando) {
      throw new BadRequestException('um provedor cli exige o comando');
    }
  }

  private resumirProvedor(provedor: ProvedorModelo): ProvedorResumido {
    const permitido = this.tipoPermitido(provedor.tipo);

    return {
      id: provedor.id,
      nome: provedor.nome,
      tipo: provedor.tipo,
      baseUrl: provedor.baseUrl,
      modelo: provedor.modelo,
      comando: provedor.comando,
      dialeto: provedor.dialeto,
      cabecalhosExtras: Object.keys(provedor.cabecalhosExtras ?? {}),
      parametros: provedor.parametros,
      ativo: provedor.ativo && permitido,
      criadoEm: provedor.criadoEm,
      chave: this.cifra.resumirSegredo(provedor.chaveCifrada),
      permitidoPeloEnv: permitido,
      ...(permitido
        ? {}
        : {
            motivoIndisponivel: `o provedor do tipo "${provedor.tipo}" está fora de PROVEDORES_PERMITIDOS no .env desta instalação`,
          }),
    };
  }

  private async ligadaEfetiva(nome: NomeCapacidade): Promise<boolean> {
    const efetiva = (await this.capacidadesEfetivas()).find(
      (item) => item.capacidade === nome,
    );

    return efetiva?.ligada ?? false;
  }

  private teto(nome: NomeCapacidade): boolean {
    return this.config.capacidades[nome];
  }

  private exigirTeto(nome: NomeCapacidade): void {
    if (!this.teto(nome)) {
      throw new ForbiddenException(
        `a capacidade "${nome}" está desligada por ${VARIAVEL_DO_ENV[nome]}=off no .env desta instalação — o banco só recorta dentro do que o .env permite, nunca amplia`,
      );
    }
  }

  private exigirCapacidadeConhecida(nome: string): NomeCapacidade {
    if (!CAPACIDADES.includes(nome as NomeCapacidade)) {
      throw new NotFoundException(
        `capacidade "${nome}" não existe — as conhecidas são ${CAPACIDADES.join(', ')}`,
      );
    }

    return nome as NomeCapacidade;
  }

  private async estado(): Promise<Instantaneo> {
    if (this.valido && this.instantaneo) {
      return this.instantaneo;
    }

    this.carregamento ??= this.carregar();

    try {
      this.instantaneo = await this.carregamento;
      this.valido = true;
    } finally {
      this.carregamento = null;
    }

    return this.instantaneo;
  }

  private avisoDeAlcance(capacidade: NomeCapacidade): string | undefined {
    if (capacidade !== 'codigo') return undefined;

    if (raizesComConteudo(this.config.escopos.repos).length > 0)
      return undefined;

    return 'ligada, mas CODIGO_REPOS não aponta para nenhuma pasta com conteúdo — a busca no código não alcança nada e a ferramenta não é oferecida ao modelo';
  }

  private async ehDiretorio(caminho: string): Promise<boolean> {
    try {
      return (await stat(caminho)).isDirectory();
    } catch {
      return false;
    }
  }

  private async invalidar(): Promise<void> {
    this.valido = false;
    this.carregamento = null;

    await this.estado();
  }

  private async carregar(): Promise<Instantaneo> {
    const [linhas, fontes, alvos, servicos, provedores, modulos, personas] =
      await Promise.all([
        this.capacidades.find(),
        this.fontes.find(),
        this.alvos.find(),
        this.servicos.find(),
        this.modelos.find(),
        this.tabelaDeModulos.find(),
        this.personas.find(),
      ]);

    return {
      capacidades: this.consolidarCapacidades(linhas),
      fontes: this.consolidarFontes(fontes),
      alvos,
      servicos,
      provedores,
      modulos,
      persona: personas[0]?.texto?.trim() || null,
    };
  }

  private consolidarCapacidades(
    linhas: CapacidadeInstalacao[],
  ): CapacidadeEfetiva[] {
    return CAPACIDADES.map((capacidade) => {
      const tetoDoEnv = this.teto(capacidade);

      if (!tetoDoEnv) {
        return {
          capacidade,
          ligada: false,
          tetoDoEnv,
          motivoIndisponivel: `${VARIAVEL_DO_ENV[capacidade]}=off no .env desta instalação`,
        };
      }

      const linha = linhas.find(
        (item) => String(item.capacidade) === String(capacidade),
      );
      const ligada = linha ? linha.ligada : tetoDoEnv;
      const aviso = ligada ? this.avisoDeAlcance(capacidade) : undefined;

      return {
        capacidade,
        ligada,
        tetoDoEnv,
        ...(aviso ? { aviso } : {}),
        ...(ligada
          ? {}
          : { motivoIndisponivel: 'desligada na configuração do Oráculo' }),
      };
    });
  }

  private consolidarFontes(linhas: FonteConhecimento[]): FonteEfetiva[] {
    const vistos = new Set<string>();
    const efetivas: FonteEfetiva[] = [];

    for (const caminho of this.config.corpus.fontes) {
      const chave = resolve(caminho);

      if (vistos.has(chave)) continue;
      vistos.add(chave);

      efetivas.push({
        id: null,
        caminho,
        rotulo: basename(caminho) || caminho,
        origem: 'env',
        removivel: false,
      });
    }

    for (const linha of linhas) {
      if (!linha.ativa) continue;

      const chave = resolve(linha.caminho);

      if (vistos.has(chave)) continue;
      vistos.add(chave);

      efetivas.push({
        id: linha.id,
        caminho: linha.caminho,
        rotulo: linha.rotulo,
        origem: 'banco',
        removivel: true,
      });
    }

    return efetivas;
  }

  private resumirAlvo(alvo: AlvoBanco): AlvoBancoResumido {
    return {
      id: alvo.id,
      nome: alvo.nome,
      schemas: alvo.schemas ?? [],
      colunasMascaradas: alvo.colunasMascaradas ?? [],
      ativo: alvo.ativo,
      criadoEm: alvo.criadoEm,
      conexao: this.cifra.resumir(alvo.url),
    };
  }

  private resumirServico(servico: ServicoObservavel): ServicoResumido {
    return {
      id: servico.id,
      nome: servico.nome,
      rotulo: servico.rotulo,
      ativo: servico.ativo,
      criadoEm: servico.criadoEm,
    };
  }

  private rotuloLigada(valor?: boolean): string {
    if (valor === undefined) {
      return 'inexistente';
    }

    return valor ? 'ligada' : 'desligada';
  }

  private referenciaUsuario(id?: string | null): Usuario | null {
    return id ? ({ id } as Usuario) : null;
  }

  private async auditar(
    usuarioId: string | null | undefined,
    acao: string,
    argumento: Record<string, unknown>,
    resultado: string,
  ): Promise<void> {
    await this.seguranca.registrar({
      usuarioId: usuarioId ?? null,
      pergunta: `configuração do ambiente: ${acao}`,
      ferramentas: [{ nome: acao, argumento, status: 'aplicada' }],
      fontes: 0,
      resultado,
      tom: 'configuracao',
      duracaoMs: 0,
      modelo: '(configuracao)',
    });
  }
}
