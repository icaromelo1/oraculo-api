import { Injectable } from '@nestjs/common';
import type { OcorrenciaRedacao, ResultadoRedacao, TipoSegredo } from './tipos';

const ABRE = '\u0001';
const FECHA = '\u0002';

interface Padrao {
  tipo: TipoSegredo;
  expressao: RegExp;
  validar?: (grupos: string[]) => boolean;
  montar?: (grupos: string[], mascara: string) => string;
}

function apenasDigitos(valor: string): string {
  return valor.replace(/\D/g, '');
}

function digitosRepetidos(valor: string): boolean {
  return new Set(valor).size === 1;
}

function cpfValido(bruto: string): boolean {
  const digitos = apenasDigitos(bruto);

  if (digitos.length !== 11 || digitosRepetidos(digitos)) {
    return false;
  }

  const verificador = (ate: number, pesoInicial: number): number => {
    let soma = 0;

    for (let i = 0; i < ate; i += 1) {
      soma += Number(digitos[i]) * (pesoInicial - i);
    }

    const resto = (soma * 10) % 11;

    return resto === 10 ? 0 : resto;
  };

  return (
    verificador(9, 10) === Number(digitos[9]) &&
    verificador(10, 11) === Number(digitos[10])
  );
}

function cnpjValido(bruto: string): boolean {
  const digitos = apenasDigitos(bruto);

  if (digitos.length !== 14 || digitosRepetidos(digitos)) {
    return false;
  }

  const verificador = (ate: number): number => {
    let peso = ate - 7;
    let soma = 0;

    for (let i = 0; i < ate; i += 1) {
      soma += Number(digitos[i]) * peso;
      peso -= 1;

      if (peso < 2) {
        peso = 9;
      }
    }

    const resto = soma % 11;

    return resto < 2 ? 0 : 11 - resto;
  };

  return (
    verificador(12) === Number(digitos[12]) &&
    verificador(13) === Number(digitos[13])
  );
}

function luhnValido(bruto: string): boolean {
  const digitos = apenasDigitos(bruto);

  if (digitos.length < 13 || digitos.length > 19 || digitosRepetidos(digitos)) {
    return false;
  }

  let soma = 0;
  let dobra = false;

  for (let i = digitos.length - 1; i >= 0; i -= 1) {
    let valor = Number(digitos[i]);

    if (dobra) {
      valor *= 2;

      if (valor > 9) {
        valor -= 9;
      }
    }

    soma += valor;
    dobra = !dobra;
  }

  return soma % 10 === 0;
}

const CHAVES_SENHA =
  'senha|password|passwd|pwd|db[_-]?pass(?:word)?|pg[_-]?password|mysql[_-]?pwd';

const CHAVES_TOKEN =
  'token|api[_-]?key|apikey|access[_-]?key|secret[_-]?access[_-]?key|secret[_-]?key|client[_-]?secret|secret|authorization|auth[_-]?token|refresh[_-]?token|private[_-]?key|jwt[_-]?secret|webhook[_-]?url';

const chaveValor = (chaves: string): RegExp =>
  new RegExp(
    `(?<![A-Za-z0-9])(${chaves})(\\s*[:=]\\s*)(["'\`]?)([^\\s"'\`,;\\u0001\\u0002]{4,})\\3`,
    'gi',
  );

const ESQUEMA_HTTP = /^(?:bearer|basic|token|digest)$/i;

const valorAindaVisivel = (grupos: string[]): boolean =>
  !grupos[4].startsWith('[oculto:') && !ESQUEMA_HTTP.test(grupos[4]);

const PADROES: Padrao[] = [
  {
    tipo: 'chave_privada',
    expressao:
      /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g,
  },
  {
    tipo: 'token',
    expressao: /\b(Bearer|Basic|Token)\s+([A-Za-z0-9\-._~+/]{8,}={0,2})/gi,
    montar: (grupos, mascara) => `${grupos[1]} ${mascara}`,
  },
  {
    tipo: 'token',
    expressao:
      /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g,
  },
  {
    tipo: 'token',
    expressao:
      /\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,})/g,
  },
  {
    tipo: 'senha',
    expressao: chaveValor(CHAVES_SENHA),
    validar: valorAindaVisivel,
    montar: (grupos, mascara) =>
      `${grupos[1]}${grupos[2]}${grupos[3]}${mascara}${grupos[3]}`,
  },
  {
    tipo: 'token',
    expressao: chaveValor(CHAVES_TOKEN),
    validar: valorAindaVisivel,
    montar: (grupos, mascara) =>
      `${grupos[1]}${grupos[2]}${grupos[3]}${mascara}${grupos[3]}`,
  },
  {
    tipo: 'senha',
    expressao: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+):([^\s:@/]{1,})@/gi,
    montar: (grupos, mascara) => `${grupos[1]}:${mascara}@`,
  },
  {
    tipo: 'cnpj',
    expressao: /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g,
  },
  {
    tipo: 'cnpj',
    expressao: /\b\d{14}\b/g,
    validar: (grupos) => cnpjValido(grupos[0]),
  },
  {
    tipo: 'cpf',
    expressao: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g,
  },
  {
    tipo: 'cpf',
    expressao: /\b\d{11}\b/g,
    validar: (grupos) => cpfValido(grupos[0]),
  },
  {
    tipo: 'cartao',
    expressao: /\b3\d{3}[ -]?\d{6}[ -]?\d{5}\b/g,
    validar: (grupos) => luhnValido(grupos[0]),
  },
  {
    tipo: 'cartao',
    expressao: /\b[2-6]\d{3}[ -]?\d{4}[ -]?\d{4}[ -]?\d{1,7}\b/g,
    validar: (grupos) => luhnValido(grupos[0]),
  },
  {
    tipo: 'email',
    expressao: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\b/g,
  },
  {
    tipo: 'telefone',
    expressao: /(?:\+55[\s-]?)?\(\d{2}\)\s?9?\d{4}[-\s]?\d{4}\b/g,
  },
  {
    tipo: 'telefone',
    expressao: /\+55[\s-]?\d{2}[\s-]?9?\d{4}[-\s]?\d{4}\b/g,
  },
  {
    tipo: 'telefone',
    expressao: /\b\d{2}\s9?\d{4}-\d{4}\b/g,
  },
  {
    tipo: 'telefone',
    expressao: /\b9\d{4}-\d{4}\b/g,
  },
];

@Injectable()
export class RedactionService {
  redigir(texto: string): ResultadoRedacao {
    if (!texto) {
      return { texto: texto ?? '', total: 0, ocorrencias: [] };
    }

    const guardadas: TipoSegredo[] = [];
    let trabalho = texto;

    for (const padrao of PADROES) {
      trabalho = trabalho.replace(padrao.expressao, (...argumentos) => {
        const grupos = argumentos
          .slice(0, -2)
          .map((valor) => (typeof valor === 'string' ? valor : ''));

        if (padrao.validar && !padrao.validar(grupos)) {
          return grupos[0];
        }

        const marcador = `${ABRE}${guardadas.length}${FECHA}`;
        guardadas.push(padrao.tipo);

        return padrao.montar ? padrao.montar(grupos, marcador) : marcador;
      });
    }

    const final = trabalho.replace(
      new RegExp(`${ABRE}(\\d+)${FECHA}`, 'g'),
      (_todo, indice: string) => `[oculto:${guardadas[Number(indice)]}]`,
    );

    return {
      texto: final,
      total: guardadas.length,
      ocorrencias: this.agrupar(guardadas),
    };
  }

  private agrupar(tipos: TipoSegredo[]): OcorrenciaRedacao[] {
    const contagem = new Map<TipoSegredo, number>();

    for (const tipo of tipos) {
      contagem.set(tipo, (contagem.get(tipo) ?? 0) + 1);
    }

    return [...contagem.entries()]
      .map(([tipo, quantidade]) => ({ tipo, quantidade }))
      .sort((a, b) => a.tipo.localeCompare(b.tipo));
  }
}
