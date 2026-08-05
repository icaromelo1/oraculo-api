const NAO_CADASTRADO = '[não cadastrado]';

const IDS_RECORTADOS = new Set(['servicos_ativos', 'portas_escutando']);

export function recortaInventario(entradaId: string): boolean {
  return IDS_RECORTADOS.has(entradaId);
}

function nomeDoServicoNaLinha(linha: string): string | null {
  const casamento = /(?:^|\s)servico=([^\s\t]+)/.exec(linha);

  return casamento ? casamento[1] : null;
}

function recortarContainers(texto: string, permitidos: Set<string>): string {
  const linhas = texto.split('\n');
  const mantidas: string[] = [];
  let ocultos = 0;

  for (const linha of linhas) {
    if (!linha.trim()) continue;

    const nome = nomeDoServicoNaLinha(linha);

    if (nome === null) {
      mantidas.push(linha);
      continue;
    }

    if (permitidos.has(nome)) {
      mantidas.push(linha);
    } else {
      ocultos += 1;
    }
  }

  const nenhumSobreviveu = mantidas.length === 0;

  if (nenhumSobreviveu) {
    mantidas.push('(nenhum serviço cadastrado está de pé)');
  }

  if (ocultos > 0) {
    mantidas.push(
      `(${ocultos} outro(s) serviço(s) de pé nesta máquina não estão cadastrados como observáveis e foram omitidos)`,
    );
  }

  return mantidas.join('\n');
}

function recortarPortas(texto: string, permitidos: Set<string>): string {
  return texto
    .split('\n')
    .map((linha) =>
      linha.replace(/users:\(\((.*)\)\)/, (trecho, miolo: string) => {
        const nome = /^"([^"]+)"/.exec(miolo)?.[1];

        return nome && permitidos.has(nome)
          ? trecho
          : `users:(${NAO_CADASTRADO})`;
      }),
    )
    .join('\n');
}

export function recortarInventario(
  entradaId: string,
  texto: string,
  nomesCadastrados: readonly string[],
): string {
  const permitidos = new Set(nomesCadastrados);

  if (entradaId === 'servicos_ativos') {
    return recortarContainers(texto, permitidos);
  }

  if (entradaId === 'portas_escutando') {
    return recortarPortas(texto, permitidos);
  }

  return texto;
}
