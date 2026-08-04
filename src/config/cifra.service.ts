import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { OraculoConfig } from './config.service';

const ALGORITMO = 'aes-256-gcm';
const VERSAO = 'v1';
const SAL = 'oraculo:configuracao:v1';
const TAMANHO_IV = 12;
const TAMANHO_CHAVE = 32;

export interface ResumoConexao {
  host: string;
  porta: string | null;
  base: string;
  usuario: string;
}

const HOST_DESCONHECIDO = '(host indisponível)';

export function mascararHost(host: string): string {
  if (!host) {
    return HOST_DESCONHECIDO;
  }

  const partes = host.split('.');

  if (partes.length === 4 && partes.every((parte) => /^\d+$/.test(parte))) {
    return `${partes[0]}.${partes[1]}.•.•`;
  }

  if (partes.length <= 1) {
    return `${host.slice(0, 2)}${'•'.repeat(Math.max(host.length - 2, 1))}`;
  }

  const primeiro = partes[0];
  const visivel = primeiro.slice(0, 2);

  return [
    `${visivel}${'•'.repeat(Math.max(primeiro.length - visivel.length, 1))}`,
    ...partes.slice(1),
  ].join('.');
}

export function resumirUrl(url: string): ResumoConexao {
  try {
    const analisada = new URL(url);

    return {
      host: mascararHost(analisada.hostname),
      porta: analisada.port || null,
      base: analisada.pathname.replace(/^\//, '') || '(sem base)',
      usuario: decodeURIComponent(analisada.username) || '(sem usuário)',
    };
  } catch {
    return {
      host: HOST_DESCONHECIDO,
      porta: null,
      base: '(sem base)',
      usuario: '(sem usuário)',
    };
  }
}

@Injectable()
export class CifraService {
  private chaveCache: Buffer | null = null;

  constructor(private readonly config: OraculoConfig) {}

  cifrar(texto: string): string {
    const iv = randomBytes(TAMANHO_IV);
    const cifra = createCipheriv(ALGORITMO, this.chave(), iv);
    const corpo = Buffer.concat([cifra.update(texto, 'utf8'), cifra.final()]);

    return [
      VERSAO,
      iv.toString('base64'),
      cifra.getAuthTag().toString('base64'),
      corpo.toString('base64'),
    ].join(':');
  }

  decifrar(guardado: string): string {
    const [versao, iv, marca, corpo] = guardado.split(':');

    if (versao !== VERSAO || !iv || !marca || !corpo) {
      throw new Error('valor cifrado em formato desconhecido');
    }

    const decifra = createDecipheriv(
      ALGORITMO,
      this.chave(),
      Buffer.from(iv, 'base64'),
    );

    decifra.setAuthTag(Buffer.from(marca, 'base64'));

    return Buffer.concat([
      decifra.update(Buffer.from(corpo, 'base64')),
      decifra.final(),
    ]).toString('utf8');
  }

  resumir(guardado: string): ResumoConexao {
    try {
      return resumirUrl(this.decifrar(guardado));
    } catch {
      return {
        host: HOST_DESCONHECIDO,
        porta: null,
        base: '(sem base)',
        usuario: '(sem usuário)',
      };
    }
  }

  private chave(): Buffer {
    if (!this.chaveCache) {
      this.chaveCache = scryptSync(
        this.config.segredoDeConfiguracao,
        SAL,
        TAMANHO_CHAVE,
      );
    }

    return this.chaveCache;
  }
}
