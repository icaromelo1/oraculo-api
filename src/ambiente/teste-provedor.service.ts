import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CifraService } from '../config/cifra.service';
import { OraculoConfig } from '../config/config.service';
import {
  ConfiguracaoService,
  type NovoProvedor,
  type ProvedorAtivo,
} from '../config/configuracao.service';
import { TIPOS_DE_PROVEDOR } from '../config/env.schema';
import { ProvedorModelo, TipoProvedorModelo } from '../database/entities';
import { validarEnderecoDeProvedor } from '../providers/endereco-seguro';
import type { EventoProvedor, LlmProvider } from '../providers/llm-provider';
import type { ConfigDoProvedor } from '../providers/provider.factory';
import { configDoAtivo } from '../providers/resolvedor';
import { RedactionService } from '../security/redaction.service';
import { SecurityService } from '../security/security.service';

export const FABRICA_DE_PROVEDOR = Symbol('FABRICA_DE_PROVEDOR');

export type FabricaDeProvedor = (config: ConfigDoProvedor) => LlmProvider;

export interface ResultadoDoTeste {
  ok: boolean;
  latenciaMs: number;
  modelo: string | null;
  amostra: string | null;
  tokensEntrada: number | null;
  tokensSaida: number | null;
  erro: string | null;
}

const TIMEOUT_DO_TESTE_MS = 20_000;
const MAX_TOKENS_DO_TESTE = 32;
const LIMITE_DA_AMOSTRA = 200;
const LIMITE_DO_ERRO = 500;
const TAMANHO_MINIMO_PARA_MASCARAR = 8;
const MASCARA = '[oculto:token]';
const EXPIROU = 'expirou';

const SISTEMA_DO_TESTE =
  'Você é um teste de conexão. Responda exatamente "ok", sem nenhuma outra palavra.';
const PERGUNTA_DO_TESTE = 'responda apenas: ok';

const ACAO = 'ambiente.provedor.testar';

function dicaDoCodigo(codigo: string): string | null {
  if (codigo.endsWith('_401') || codigo === 'autenticacao') {
    return 'a chave foi recusada pelo provedor (401)';
  }

  if (codigo.endsWith('_403')) {
    return 'a chave não tem permissão para esse modelo ou endpoint (403)';
  }

  if (codigo.endsWith('_404')) {
    return 'o endereço ou o modelo não existe nesse provedor (404)';
  }

  if (codigo.endsWith('_429') || codigo === 'rate_limit') {
    return 'o provedor recusou por excesso de requisições (429)';
  }

  if (codigo === 'cli_spawn_falhou') {
    return 'o binário do CLI não foi encontrado ou não pôde ser executado';
  }

  if (codigo === 'cli_saida_nao_zero') {
    return 'o CLI terminou com erro';
  }

  if (codigo === 'cli_timeout') {
    return 'o CLI não respondeu dentro do tempo';
  }

  if (codigo === 'openai_conexao_falhou' || codigo === 'conexao') {
    return 'não foi possível conectar ao endereço informado (DNS, rede ou porta fechada)';
  }

  if (codigo === 'openai_stream_falhou') {
    return 'a conexão caiu no meio da resposta';
  }

  if (codigo === 'dialeto_invalido') {
    return 'o dialeto configurado para o CLI não pôde ser lido';
  }

  return null;
}

function descreverFalha(codigo: string, bruta: string): string {
  const mensagem = bruta.trim();
  const dica = dicaDoCodigo(codigo);

  if (!dica) {
    return mensagem || `o provedor falhou (${codigo})`;
  }

  return mensagem ? `${dica}: ${mensagem}` : dica;
}

@Injectable()
export class TesteDeProvedorService {
  constructor(
    private readonly config: OraculoConfig,
    private readonly cifra: CifraService,
    private readonly seguranca: SecurityService,
    private readonly redacao: RedactionService,
    @Inject(FABRICA_DE_PROVEDOR)
    private readonly fabrica: FabricaDeProvedor,
    @InjectRepository(ProvedorModelo)
    private readonly modelos: Repository<ProvedorModelo>,
    private readonly configuracao: ConfiguracaoService,
  ) {}

  async testarCadastrado(
    id: string,
    usuarioId?: string | null,
  ): Promise<ResultadoDoTeste> {
    const provedor = await this.modelos.findOne({ where: { id } });

    if (!provedor) {
      throw new NotFoundException(`provedor de modelo "${id}" não existe`);
    }

    this.exigirTipoPermitido(provedor.tipo);

    let chave: string | null;

    try {
      chave = provedor.chaveCifrada
        ? this.cifra.decifrar(provedor.chaveCifrada)
        : null;
    } catch {
      return this.recusar(
        this.ativoDoCadastro(provedor, null),
        'a chave gravada não pôde ser decifrada com o segredo atual desta instalação — cadastre o provedor de novo',
        usuarioId,
      );
    }

    return this.executar(this.ativoDoCadastro(provedor, chave), usuarioId);
  }

  async testarAvulso(
    novo: NovoProvedor,
    usuarioId?: string | null,
  ): Promise<ResultadoDoTeste> {
    const tipo = this.exigirTipoPermitido(novo.tipo);

    return this.executar(
      {
        id: '',
        nome: novo.nome,
        tipo,
        baseUrl: novo.baseUrl ?? null,
        modelo: novo.modelo ?? null,
        chave: novo.chave ?? null,
        cabecalhosExtras: novo.cabecalhosExtras ?? null,
        parametros: novo.parametros ?? null,
        comando: novo.comando ?? null,
        dialeto: novo.dialeto ?? null,
      },
      usuarioId,
    );
  }

  private ativoDoCadastro(
    provedor: ProvedorModelo,
    chave: string | null,
  ): ProvedorAtivo {
    return {
      id: provedor.id,
      nome: provedor.nome,
      tipo: provedor.tipo,
      baseUrl: provedor.baseUrl,
      modelo: provedor.modelo,
      chave,
      cabecalhosExtras: provedor.cabecalhosExtras,
      parametros: provedor.parametros,
      comando: provedor.comando,
      dialeto: provedor.dialeto,
    };
  }

  private async executar(
    ativo: ProvedorAtivo,
    usuarioId?: string | null,
  ): Promise<ResultadoDoTeste> {
    const inicio = Date.now();
    let config: ConfigDoProvedor;

    try {
      config = this.configurar(ativo);
    } catch (erro) {
      return this.recusar(
        ativo,
        erro instanceof Error
          ? erro.message
          : 'o provedor informado não pôde ser montado',
        usuarioId,
        Date.now() - inicio,
      );
    }

    let resultado: ResultadoDoTeste;

    try {
      resultado = await this.consumir(
        this.fabrica(config),
        this.modeloDe(config),
        ativo.chave,
      );
    } catch (erro) {
      resultado = {
        ok: false,
        latenciaMs: Date.now() - inicio,
        modelo: this.modeloDe(config),
        amostra: null,
        tokensEntrada: null,
        tokensSaida: null,
        erro: this.higienizar(
          erro instanceof Error
            ? erro.message
            : 'falha inesperada ao falar com o provedor',
          ativo.chave,
        ),
      };
    }

    await this.auditar(ativo, resultado, usuarioId);

    return resultado;
  }

  private async recusar(
    ativo: ProvedorAtivo,
    motivo: string,
    usuarioId?: string | null,
    latenciaMs = 0,
  ): Promise<ResultadoDoTeste> {
    const resultado: ResultadoDoTeste = {
      ok: false,
      latenciaMs,
      modelo: ativo.modelo,
      amostra: null,
      tokensEntrada: null,
      tokensSaida: null,
      erro: this.higienizar(motivo, ativo.chave),
    };

    await this.auditar(ativo, resultado, usuarioId);

    return resultado;
  }

  private configurar(ativo: ProvedorAtivo): ConfigDoProvedor {
    const base = configDoAtivo(ativo, this.config.provedor);
    const config: ConfigDoProvedor = {
      ...base,
      cliTimeoutMs: Math.min(
        base.cliTimeoutMs || TIMEOUT_DO_TESTE_MS,
        TIMEOUT_DO_TESTE_MS,
      ),
    };

    if (config.tipo === 'openai-compat') {
      if (!config.openaiBaseUrl || !config.openaiModelo) {
        throw new BadRequestException(
          'um provedor openai-compat exige baseUrl e modelo',
        );
      }

      const veredicto = validarEnderecoDeProvedor(config.openaiBaseUrl);

      if (!veredicto.aprovado) {
        throw new BadRequestException(veredicto.motivo);
      }
    }

    if (config.tipo === 'anthropic' && !config.anthropicChave) {
      throw new BadRequestException('um provedor anthropic exige a chave');
    }

    if (config.tipo === 'cli' && !config.cliComando) {
      throw new BadRequestException('um provedor cli exige o comando');
    }

    return config;
  }

  private modeloDe(config: ConfigDoProvedor): string | null {
    if (config.tipo === 'anthropic') {
      return config.anthropicModelo ?? null;
    }

    if (config.tipo === 'openai-compat') {
      return config.openaiModelo ?? null;
    }

    return config.cliModelo ?? null;
  }

  private async consumir(
    provedor: LlmProvider,
    modelo: string | null,
    chave: string | null,
  ): Promise<ResultadoDoTeste> {
    const inicio = Date.now();
    const iterador = provedor
      .gerar({
        sistema: SISTEMA_DO_TESTE,
        mensagens: [{ papel: 'usuario', texto: PERGUNTA_DO_TESTE }],
        maxTokens: MAX_TOKENS_DO_TESTE,
      })
      [Symbol.asyncIterator]();

    let cronometro: ReturnType<typeof setTimeout> | undefined;

    const prazo = new Promise<typeof EXPIROU>((resolver) => {
      cronometro = setTimeout(() => resolver(EXPIROU), TIMEOUT_DO_TESTE_MS);
    });

    let acumulado = '';
    let tokensEntrada: number | null = null;
    let tokensSaida: number | null = null;
    let erro: string | null = null;

    try {
      for (;;) {
        const passo: IteratorResult<EventoProvedor> | typeof EXPIROU =
          await Promise.race([iterador.next(), prazo]);

        if (passo === EXPIROU) {
          erro = `o provedor não respondeu em ${Math.round(
            TIMEOUT_DO_TESTE_MS / 1000,
          )}s`;
          break;
        }

        if (passo.done) {
          break;
        }

        const evento = passo.value;

        if (evento.tipo === 'texto') {
          acumulado += evento.fragmento;

          if (acumulado.length >= LIMITE_DA_AMOSTRA) {
            break;
          }

          continue;
        }

        if (evento.tipo === 'fim') {
          tokensEntrada = evento.tokensEntrada;
          tokensSaida = evento.tokensSaida;
          break;
        }

        if (evento.tipo === 'erro') {
          erro = descreverFalha(evento.codigo, evento.mensagem);
          break;
        }
      }
    } catch (falha) {
      erro =
        falha instanceof Error
          ? falha.message
          : 'falha inesperada ao ler a resposta do provedor';
    } finally {
      if (cronometro) {
        clearTimeout(cronometro);
      }

      void Promise.resolve(iterador.return?.()).catch(() => undefined);
    }

    const amostra = acumulado.trim().slice(0, LIMITE_DA_AMOSTRA);

    return {
      ok: erro === null,
      latenciaMs: Date.now() - inicio,
      modelo,
      amostra: amostra || null,
      tokensEntrada,
      tokensSaida,
      erro: erro === null ? null : this.higienizar(erro, chave),
    };
  }

  private higienizar(texto: string, chave: string | null): string {
    const semChave =
      chave && chave.length >= TAMANHO_MINIMO_PARA_MASCARAR
        ? texto.split(chave).join(MASCARA)
        : texto;
    const redigido = this.redacao.redigir(semChave).texto;

    return redigido.length > LIMITE_DO_ERRO
      ? `${redigido.slice(0, LIMITE_DO_ERRO)}…`
      : redigido;
  }

  private exigirTipoPermitido(bruto: string): TipoProvedorModelo {
    const tipo = String(bruto).trim() as TipoProvedorModelo;

    if (!TIPOS_DE_PROVEDOR.includes(tipo)) {
      throw new BadRequestException(
        `tipo de provedor "${bruto}" não existe — os conhecidos são ${TIPOS_DE_PROVEDOR.join(', ')}`,
      );
    }

    if (!this.configuracao.tipoDeProvedorPermitido(tipo)) {
      throw new ForbiddenException(
        `o provedor do tipo "${tipo}" está fora de PROVEDORES_PERMITIDOS no .env desta instalação — o banco só recorta dentro do que o .env permite, nunca amplia`,
      );
    }

    return tipo;
  }

  private async auditar(
    ativo: ProvedorAtivo,
    resultado: ResultadoDoTeste,
    usuarioId?: string | null,
  ): Promise<void> {
    const alvo = `"${ativo.nome}" (${ativo.tipo})`;

    await this.seguranca.registrar({
      usuarioId: usuarioId ?? null,
      pergunta: `configuração do ambiente: ${ACAO}`,
      ferramentas: [
        {
          nome: ACAO,
          argumento: {
            id: ativo.id || null,
            nome: ativo.nome,
            tipo: ativo.tipo,
            modelo: ativo.modelo,
            baseUrl: ativo.baseUrl,
            cadastrado: Boolean(ativo.id),
          },
          status: 'aplicada',
        },
      ],
      fontes: 0,
      resultado: resultado.ok
        ? `teste de conexão com ${alvo} respondeu em ${resultado.latenciaMs}ms`
        : `teste de conexão com ${alvo} falhou: ${resultado.erro}`,
      tom: 'configuracao',
      duracaoMs: resultado.latenciaMs,
      modelo: resultado.modelo ?? '(desconhecido)',
    });
  }
}
