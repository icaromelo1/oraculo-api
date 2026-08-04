import { Injectable } from '@nestjs/common';
import { userInfo } from 'os';
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

const IPV4_OCTETO = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';

const IPV4_REGEX = new RegExp(
  `\\b(${IPV4_OCTETO}(?:\\.${IPV4_OCTETO}){3})(:(\\d{1,5}))?(\\/\\d{1,2})?\\b`,
  'g',
);

const ipv4Preservado = (grupos: string[]): boolean =>
  grupos[1] === '127.0.0.1' || Boolean(grupos[4]);

const IPV6_GRUPO = '[0-9A-Fa-f]{1,4}';

const IPV6_LIMITE_ANTES = '(?<![0-9A-Fa-f:.])';
const IPV6_LIMITE_DEPOIS = '(?![0-9A-Fa-f:.])';

const IPV6_ALTERNATIVAS = [
  `(?:${IPV6_GRUPO}:){7}${IPV6_GRUPO}`,
  `(?:${IPV6_GRUPO}:){1,7}:`,
  `(?:${IPV6_GRUPO}:){1,6}:${IPV6_GRUPO}`,
  `(?:${IPV6_GRUPO}:){1,5}(?::${IPV6_GRUPO}){1,2}`,
  `(?:${IPV6_GRUPO}:){1,4}(?::${IPV6_GRUPO}){1,3}`,
  `(?:${IPV6_GRUPO}:){1,3}(?::${IPV6_GRUPO}){1,4}`,
  `(?:${IPV6_GRUPO}:){1,2}(?::${IPV6_GRUPO}){1,5}`,
  `${IPV6_GRUPO}:(?:(?::${IPV6_GRUPO}){1,6})`,
  `:(?:(?::${IPV6_GRUPO}){1,7}|:)`,
].join('|');

const IPV6_REGEX = new RegExp(
  `${IPV6_LIMITE_ANTES}(${IPV6_ALTERNATIVAS})(\\/\\d{1,3})?${IPV6_LIMITE_DEPOIS}`,
  'g',
);

const ipv6Preservado = (grupos: string[]): boolean => {
  const valor = grupos[1].toLowerCase();

  return valor === '::1' || Boolean(grupos[2]);
};

const IPV6_COLCHETE_REGEX = /\[([0-9A-Fa-f:]+)\]:(\d{1,5})/g;

const ipv6ColcheteMontar = (grupos: string[], mascara: string): string =>
  `${mascara}:${grupos[2]}`;

const IPV6_CORINGA_REGEX = /:::(\d{1,5})\b/g;

const ipv6CoringaMontar = (grupos: string[], mascara: string): string =>
  `${mascara}:${grupos[1]}`;

const MAC_REGEX = /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g;

const ROTULO_HOST = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?';

const GUARDA_CAMINHO = '(?<![^/]\\/)';

const FQDN_CONTEXTO_REGEX = new RegExp(
  `(?<=:\\/\\/|@)${GUARDA_CAMINHO}((?:${ROTULO_HOST}\\.)+[A-Za-z]{2,63})\\b(:(\\d{1,5}))?`,
  'g',
);

const FQDN_ESTRUTURA_REGEX = new RegExp(
  `\\b${GUARDA_CAMINHO}((?:${ROTULO_HOST}\\.){2,}[A-Za-z]{2,63})\\b(:(\\d{1,5}))?`,
  'g',
);

const USUARIO_ATUAL = process.env.USUARIO_DONO?.trim() || userInfo().username;

const escaparRegex = (valor: string): string =>
  valor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const HOME_ALHEIO_REGEX = new RegExp(
  `(\\/home\\/)(?!${escaparRegex(USUARIO_ATUAL)}(?:\\/|$))([A-Za-z0-9_.-]+)`,
  'g',
);

const preservarPortaOuVazio = (grupos: string[], mascara: string): string =>
  `${mascara}${grupos[2] ?? ''}`;

const PADROES_DIAGNOSTICO: Padrao[] = [
  {
    tipo: 'ip',
    expressao: MAC_REGEX,
  },
  {
    tipo: 'ip',
    expressao: IPV6_COLCHETE_REGEX,
    validar: (grupos) => grupos[1].toLowerCase() !== '::1',
    montar: ipv6ColcheteMontar,
  },
  {
    tipo: 'ip',
    expressao: IPV6_CORINGA_REGEX,
    montar: ipv6CoringaMontar,
  },
  {
    tipo: 'ip',
    expressao: IPV6_REGEX,
    validar: (grupos) => !ipv6Preservado(grupos),
  },
  {
    tipo: 'ip',
    expressao: IPV4_REGEX,
    validar: (grupos) => !ipv4Preservado(grupos),
    montar: preservarPortaOuVazio,
  },
  {
    tipo: 'host',
    expressao: HOME_ALHEIO_REGEX,
    montar: (grupos, mascara) => `${grupos[1]}${mascara}`,
  },
  {
    tipo: 'host',
    expressao: FQDN_CONTEXTO_REGEX,
    montar: preservarPortaOuVazio,
  },
  {
    tipo: 'host',
    expressao: FQDN_ESTRUTURA_REGEX,
    montar: preservarPortaOuVazio,
  },
];

@Injectable()
export class RedactionService {
  redigir(texto: string): ResultadoRedacao {
    return this.aplicar(texto, PADROES);
  }

  redigirDiagnostico(texto: string): ResultadoRedacao {
    return this.aplicar(texto, [...PADROES, ...PADROES_DIAGNOSTICO]);
  }

  private aplicar(texto: string, padroes: Padrao[]): ResultadoRedacao {
    if (!texto) {
      return { texto: texto ?? '', total: 0, ocorrencias: [] };
    }

    const guardadas: TipoSegredo[] = [];
    let trabalho = texto;

    for (const padrao of padroes) {
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
