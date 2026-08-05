import type { AbridorDeSessao, RespostaConsulta, SessaoBanco } from './conexao';

export interface SessaoFalsa {
  readonly abridor: AbridorDeSessao;
  readonly comandos: string[];
  readonly parametros: unknown[][];
  readonly urls: string[];
  encerrada: boolean;
}

export interface RoteiroSessao {
  readonly respostas?: Record<string, RespostaConsulta>;
  readonly padrao?: RespostaConsulta;
  readonly falharEm?: RegExp;
  readonly erroDeConexao?: string;
}

const VAZIA: RespostaConsulta = { colunas: [], linhas: [] };

export function criarSessaoFalsa(roteiro: RoteiroSessao = {}): SessaoFalsa {
  const estado: SessaoFalsa = {
    abridor: () => Promise.reject(new Error('não inicializado')),
    comandos: [],
    parametros: [],
    urls: [],
    encerrada: false,
  };

  const sessao: SessaoBanco = {
    executar(sql, valores) {
      estado.comandos.push(sql);
      estado.parametros.push(valores ?? []);

      if (roteiro.falharEm?.test(sql)) {
        return Promise.reject(new Error(`falha simulada em: ${sql}`));
      }

      const casada = Object.entries(roteiro.respostas ?? {}).find(([chave]) =>
        sql.includes(chave),
      );

      return Promise.resolve(casada?.[1] ?? roteiro.padrao ?? VAZIA);
    },
    encerrar() {
      estado.encerrada = true;

      return Promise.resolve();
    },
  };

  const mutavel = estado as { abridor: AbridorDeSessao };

  mutavel.abridor = (url) => {
    estado.urls.push(url);

    return roteiro.erroDeConexao
      ? Promise.reject(new Error(roteiro.erroDeConexao))
      : Promise.resolve(sessao);
  };

  return estado;
}
