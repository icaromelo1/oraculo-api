import type { ResultadoRedacao } from '../security/tipos';
import { limparMarcadores, marcadorParcial } from './cobertura';
import { CERCA_ABRE, CERCA_FECHA } from './protocolo';

export const JANELA = 256;

const PASSO = 16;
const ABRE_CHAVE = '-----BEGIN';
const FECHA_CHAVE = '-----END';

export type Redator = (texto: string) => ResultadoRedacao;

function sufixoParcial(texto: string, alvo: string): number {
  const maximo = Math.min(texto.length, alvo.length - 1);

  for (let tamanho = maximo; tamanho > 0; tamanho -= 1) {
    if (texto.endsWith(alvo.slice(0, tamanho))) {
      return tamanho;
    }
  }

  return 0;
}

function limiteDeChavePrivada(texto: string): number {
  const abertura = texto.lastIndexOf(ABRE_CHAVE);

  if (abertura >= 0 && texto.indexOf(FECHA_CHAVE, abertura) < 0) {
    return abertura;
  }

  return texto.length;
}

export class FluxoResposta {
  private cru = '';
  private naoClassificado = '';
  private visivel = '';
  private blocoAberto = '';
  private dentroDoBloco = false;
  private emitido = '';
  private redigidos = 0;
  private readonly pedidos: string[] = [];

  constructor(
    private readonly redigir: Redator,
    private readonly idsValidos: ReadonlySet<string>,
  ) {}

  get texto(): string {
    return this.emitido;
  }

  get bruto(): string {
    return this.cru;
  }

  get blocos(): string[] {
    return [...this.pedidos];
  }

  get ocultados(): number {
    return this.redigidos;
  }

  empurrar(fragmento: string): string {
    this.cru += fragmento;
    this.naoClassificado += fragmento;
    this.separar(false);

    return this.liberar(false);
  }

  encerrar(): string {
    this.separar(true);

    return this.liberar(true);
  }

  private separar(final: boolean): void {
    let seguir = true;

    while (seguir) {
      seguir = false;

      if (this.dentroDoBloco) {
        seguir = this.separarDentro(final);
        continue;
      }

      seguir = this.separarFora(final);
    }
  }

  private separarDentro(final: boolean): boolean {
    const fim = this.naoClassificado.indexOf(CERCA_FECHA);

    if (fim >= 0) {
      this.blocoAberto += this.naoClassificado.slice(0, fim);
      this.pedidos.push(this.blocoAberto);
      this.blocoAberto = '';
      this.naoClassificado = this.naoClassificado.slice(
        fim + CERCA_FECHA.length,
      );
      this.dentroDoBloco = false;

      return true;
    }

    const reter = final ? 0 : sufixoParcial(this.naoClassificado, CERCA_FECHA);
    const corte = this.naoClassificado.length - reter;
    this.blocoAberto += this.naoClassificado.slice(0, corte);
    this.naoClassificado = this.naoClassificado.slice(corte);

    if (final) {
      this.pedidos.push(this.blocoAberto);
      this.blocoAberto = '';
      this.dentroDoBloco = false;
    }

    return false;
  }

  private separarFora(final: boolean): boolean {
    const inicio = this.naoClassificado.indexOf(CERCA_ABRE);

    if (inicio >= 0) {
      this.visivel += this.naoClassificado.slice(0, inicio);
      this.naoClassificado = this.naoClassificado.slice(
        inicio + CERCA_ABRE.length,
      );
      this.dentroDoBloco = true;

      return true;
    }

    const reter = final ? 0 : sufixoParcial(this.naoClassificado, CERCA_ABRE);
    const corte = this.naoClassificado.length - reter;
    this.visivel += this.naoClassificado.slice(0, corte);
    this.naoClassificado = this.naoClassificado.slice(corte);

    return false;
  }

  private liberar(final: boolean): string {
    if (final) {
      const redacao = this.redigir(this.visivel);
      this.visivel = '';

      return this.entregar(redacao);
    }

    if (this.visivel.length <= JANELA) {
      return '';
    }

    const completo = this.redigir(this.visivel).texto;
    const teto = Math.min(
      limiteDeChavePrivada(this.visivel),
      marcadorParcial(this.visivel),
      this.visivel.length - JANELA,
    );

    for (let corte = teto; corte > 0; corte -= PASSO) {
      const cabeca = this.redigir(this.visivel.slice(0, corte));
      const cauda = this.redigir(this.visivel.slice(corte));

      if (cabeca.texto + cauda.texto !== completo) {
        continue;
      }

      this.visivel = this.visivel.slice(corte);

      return this.entregar(cabeca);
    }

    return '';
  }

  private entregar(redacao: ResultadoRedacao): string {
    this.redigidos += redacao.total;
    const texto = limparMarcadores(redacao.texto, this.idsValidos);
    this.emitido += texto;

    return texto;
  }
}
