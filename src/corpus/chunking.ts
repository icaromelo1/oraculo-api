import { extname } from 'node:path';

export interface TrechoBruto {
  ordem: number;
  texto: string;
  linhaInicio: number;
  linhaFim: number;
}

interface Secao {
  linhas: string[];
  linhaInicio: number;
}

interface BlocoFatiado {
  texto: string;
  linhaInicio: number;
  linhaFim: number;
}

function dividirEmSecoes(linhas: string[]): Secao[] {
  const pontos = new Set<number>([0, linhas.length]);

  linhas.forEach((linha, indice) => {
    if (indice > 0 && /^#{1,6}\s+\S/.test(linha)) {
      pontos.add(indice);
    }
  });

  const ordenados = [...pontos].sort((a, b) => a - b);
  const secoes: Secao[] = [];

  for (let i = 0; i < ordenados.length - 1; i++) {
    const inicio = ordenados[i];
    const fim = ordenados[i + 1];

    if (fim > inicio) {
      secoes.push({
        linhas: linhas.slice(inicio, fim),
        linhaInicio: inicio + 1,
      });
    }
  }

  return secoes;
}

function fatiarPorTeto(
  linhas: string[],
  linhaInicioBase: number,
  tetoCaracteres: number,
  sobreposicaoCaracteres: number,
): BlocoFatiado[] {
  if (linhas.length === 0) return [];

  const blocos: BlocoFatiado[] = [];
  let inicio = 0;

  while (inicio < linhas.length) {
    let fim = inicio;
    let tamanho = 0;

    while (fim < linhas.length) {
      const proximoTamanho = tamanho + linhas[fim].length + 1;
      if (fim > inicio && proximoTamanho > tetoCaracteres) break;
      tamanho = proximoTamanho;
      fim += 1;
    }

    const linhasDoBloco = linhas.slice(inicio, fim);
    blocos.push({
      texto: linhasDoBloco.join('\n'),
      linhaInicio: linhaInicioBase + inicio,
      linhaFim: linhaInicioBase + fim - 1,
    });

    if (fim >= linhas.length) break;

    let retrocesso = 0;
    let tamanhoRetrocesso = 0;

    while (
      retrocesso < linhasDoBloco.length - 1 &&
      tamanhoRetrocesso +
        linhasDoBloco[linhasDoBloco.length - 1 - retrocesso].length <
        sobreposicaoCaracteres
    ) {
      tamanhoRetrocesso +=
        linhasDoBloco[linhasDoBloco.length - 1 - retrocesso].length + 1;
      retrocesso += 1;
    }

    inicio = fim - retrocesso;
  }

  return blocos;
}

export function quebrarMarkdown(
  conteudo: string,
  tetoCaracteres = 1200,
  sobreposicaoCaracteres = 150,
): TrechoBruto[] {
  const linhas = conteudo.split('\n');
  const secoes = dividirEmSecoes(linhas);

  let ordem = 0;
  const trechos: TrechoBruto[] = [];

  for (const secao of secoes) {
    const blocos = fatiarPorTeto(
      secao.linhas,
      secao.linhaInicio,
      tetoCaracteres,
      sobreposicaoCaracteres,
    );

    for (const bloco of blocos) {
      trechos.push({ ordem: ordem++, ...bloco });
    }
  }

  return trechos;
}

export function quebrarCodigo(
  conteudo: string,
  linhasPorBloco = 80,
  sobreposicaoLinhas = 8,
): TrechoBruto[] {
  const linhas = conteudo.split('\n');
  const trechos: TrechoBruto[] = [];
  let inicio = 0;
  let ordem = 0;

  while (inicio < linhas.length) {
    const fim = Math.min(inicio + linhasPorBloco, linhas.length);
    const bloco = linhas.slice(inicio, fim);

    trechos.push({
      ordem: ordem++,
      texto: bloco.join('\n'),
      linhaInicio: inicio + 1,
      linhaFim: fim,
    });

    if (fim >= linhas.length) break;
    inicio = fim - sobreposicaoLinhas;
  }

  return trechos;
}

export function quebrarDocumento(
  caminho: string,
  conteudo: string,
): TrechoBruto[] {
  if (!conteudo.trim()) return [];

  const extensao = extname(caminho).toLowerCase();

  if (extensao === '.md') {
    return quebrarMarkdown(conteudo);
  }

  return quebrarCodigo(conteudo);
}
