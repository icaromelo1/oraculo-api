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
import { Repository } from 'typeorm';
import {
  AlvoBanco,
  CapacidadeInstalacao,
  FonteConhecimento,
  NomeCapacidadeInstalacao,
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

interface Instantaneo {
  capacidades: CapacidadeEfetiva[];
  fontes: FonteEfetiva[];
  alvos: AlvoBanco[];
  servicos: ServicoObservavel[];
  provedores: ProvedorModelo[];
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

  private escolherAtivo(provedores: ProvedorModelo[]): ProvedorAtivo | null {
    const ativo = provedores
      .slice()
      .sort((um, outro) => um.nome.localeCompare(outro.nome))
      .find((provedor) => provedor.ativo && this.tipoPermitido(provedor.tipo));

    if (!ativo) {
      return null;
    }

    return {
      id: ativo.id,
      nome: ativo.nome,
      tipo: ativo.tipo,
      baseUrl: ativo.baseUrl,
      modelo: ativo.modelo,
      chave: ativo.chaveCifrada
        ? this.cifra.decifrar(ativo.chaveCifrada)
        : null,
      cabecalhosExtras: ativo.cabecalhosExtras,
      parametros: ativo.parametros,
      comando: ativo.comando,
      dialeto: ativo.dialeto,
    };
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

    if (!DIALETOS.includes(informado)) {
      throw new BadRequestException(
        `dialeto "${informado}" não existe — os conhecidos são ${DIALETOS.join(', ')}`,
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
    const [linhas, fontes, alvos, servicos, provedores] = await Promise.all([
      this.capacidades.find(),
      this.fontes.find(),
      this.alvos.find(),
      this.servicos.find(),
      this.modelos.find(),
    ]);

    return {
      capacidades: this.consolidarCapacidades(linhas),
      fontes: this.consolidarFontes(fontes),
      alvos,
      servicos,
      provedores,
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
