export interface EnderecoAprovado {
  aprovado: true;
  url: string;
  host: string;
}

export interface EnderecoRecusado {
  aprovado: false;
  motivo: string;
}

export type VeredictoEndereco = EnderecoAprovado | EnderecoRecusado;

const PROTOCOLOS = ['http:', 'https:'];

const HOSTS_NEGADOS = ['metadata.google.internal'];

const LINK_LOCAL = 0xa9fe;

function limparHost(host: string): string {
  const sem =
    host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;

  return sem.replace(/\.$/, '').toLowerCase();
}

function inteiroDoOcteto(parte: string): number | null {
  if (parte === '') {
    return null;
  }

  const normalizada = parte.toLowerCase();

  if (normalizada.startsWith('0x')) {
    const corpo = normalizada.slice(2);

    return /^[0-9a-f]+$/.test(corpo) ? Number.parseInt(corpo, 16) : null;
  }

  if (normalizada.length > 1 && normalizada.startsWith('0')) {
    const corpo = normalizada.slice(1);

    return /^[0-7]+$/.test(corpo) ? Number.parseInt(corpo, 8) : null;
  }

  return /^[0-9]+$/.test(normalizada) ? Number.parseInt(normalizada, 10) : null;
}

export function inteiroIpv4(host: string): number | null {
  const partes = host.split('.');

  if (partes.length === 0 || partes.length > 4) {
    return null;
  }

  const numeros: number[] = [];

  for (const parte of partes) {
    const numero = inteiroDoOcteto(parte);

    if (numero === null || !Number.isSafeInteger(numero) || numero < 0) {
      return null;
    }

    numeros.push(numero);
  }

  const ultimo = numeros[numeros.length - 1];
  const cabeca = numeros.slice(0, -1);

  if (cabeca.some((numero) => numero > 0xff)) {
    return null;
  }

  const restante = 4 - cabeca.length;

  if (ultimo >= 256 ** restante) {
    return null;
  }

  let valor = ultimo;

  cabeca.forEach((numero, indice) => {
    valor += numero * 256 ** (3 - indice);
  });

  return valor >>> 0;
}

function bytesIpv6(host: string): number[] | null {
  if (!host.includes(':')) {
    return null;
  }

  const lados = host.split('::');

  if (lados.length > 2) {
    return null;
  }

  const expandirLado = (lado: string): number[] | null => {
    if (lado === '') {
      return [];
    }

    const grupos = lado.split(':');
    const bytes: number[] = [];

    for (let indice = 0; indice < grupos.length; indice++) {
      const grupo = grupos[indice];

      if (indice === grupos.length - 1 && grupo.includes('.')) {
        const ipv4 = inteiroIpv4(grupo);

        if (ipv4 === null) {
          return null;
        }

        bytes.push(
          (ipv4 >>> 24) & 0xff,
          (ipv4 >>> 16) & 0xff,
          (ipv4 >>> 8) & 0xff,
          ipv4 & 0xff,
        );

        continue;
      }

      if (!/^[0-9a-f]{1,4}$/.test(grupo)) {
        return null;
      }

      const valor = Number.parseInt(grupo, 16);

      bytes.push((valor >>> 8) & 0xff, valor & 0xff);
    }

    return bytes;
  };

  const inicio = expandirLado(lados[0]);
  const fim = lados.length === 2 ? expandirLado(lados[1]) : [];

  if (inicio === null || fim === null) {
    return null;
  }

  if (lados.length === 1) {
    return inicio.length === 16 ? inicio : null;
  }

  const faltando = 16 - inicio.length - fim.length;

  if (faltando < 0) {
    return null;
  }

  return [...inicio, ...Array<number>(faltando).fill(0), ...fim];
}

export function resolverIpv4(host: string): number | null {
  const direto = inteiroIpv4(host);

  if (direto !== null) {
    return direto;
  }

  const bytes = bytesIpv6(host);

  if (!bytes) {
    return null;
  }

  const mapeado =
    bytes.slice(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff;

  if (!mapeado) {
    return null;
  }

  return (
    ((bytes[12] << 24) | (bytes[13] << 16) | (bytes[14] << 8) | bytes[15]) >>> 0
  );
}

export function ehLinkLocal(host: string): boolean {
  const ipv4 = resolverIpv4(host);

  return ipv4 !== null && ipv4 >>> 16 === LINK_LOCAL;
}

export function validarEnderecoDeProvedor(bruto: string): VeredictoEndereco {
  const informado = bruto.trim();

  if (!informado) {
    return { aprovado: false, motivo: 'o endereço do provedor está vazio' };
  }

  let analisada: URL;

  try {
    analisada = new URL(informado);
  } catch {
    return {
      aprovado: false,
      motivo: `"${informado}" não é uma URL válida — informe o endereço completo, com http:// ou https://`,
    };
  }

  if (!PROTOCOLOS.includes(analisada.protocol)) {
    return {
      aprovado: false,
      motivo: `o endereço do provedor precisa usar http ou https — "${analisada.protocol.replace(':', '')}" não é aceito`,
    };
  }

  const host = limparHost(analisada.hostname);

  if (!host) {
    return {
      aprovado: false,
      motivo: `"${informado}" não tem host — informe o endereço completo do provedor`,
    };
  }

  if (HOSTS_NEGADOS.includes(host)) {
    return {
      aprovado: false,
      motivo: `"${host}" é o serviço de metadados da instância — um provedor apontado para lá leria as credenciais da máquina em que o Oráculo roda`,
    };
  }

  if (ehLinkLocal(host)) {
    return {
      aprovado: false,
      motivo: `"${analisada.hostname}" cai na faixa link-local 169.254.0.0/16, onde o provedor de nuvem serve os metadados da instância — um provedor apontado para lá leria as credenciais da máquina em que o Oráculo roda`,
    };
  }

  return { aprovado: true, url: informado, host };
}
