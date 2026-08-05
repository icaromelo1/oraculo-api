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
  ServicoObservavel,
  Usuario,
} from '../database/entities';
import type { RaizResolvida } from '../capabilities/codigo/seguranca';
import { casaAlgumPadrao } from '../corpus/denylist';
import { SecurityService } from '../security/security.service';
import { CifraService, ResumoConexao } from './cifra.service';
import { OraculoConfig } from './config.service';
import {
  CaminhoNaRaiz,
  raizesPermitidas,
  resolverCaminhoNasRaizes,
} from './raiz-permitida';

export type NomeCapacidade = `${NomeCapacidadeInstalacao}`;

export const CAPACIDADES: NomeCapacidade[] = [
  'conhecimento',
  'codigo',
  'estado',
  'banco',
];

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

interface Instantaneo {
  capacidades: CapacidadeEfetiva[];
  fontes: FonteEfetiva[];
  alvos: AlvoBanco[];
  servicos: ServicoObservavel[];
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
    const [linhas, fontes, alvos, servicos] = await Promise.all([
      this.capacidades.find(),
      this.fontes.find(),
      this.alvos.find(),
      this.servicos.find(),
    ]);

    return {
      capacidades: this.consolidarCapacidades(linhas),
      fontes: this.consolidarFontes(fontes),
      alvos,
      servicos,
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

      return {
        capacidade,
        ligada,
        tetoDoEnv,
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
