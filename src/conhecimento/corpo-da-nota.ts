const HEADING = /^#{1,6}\s+\S/;

export function corpoDaNota(titulo: string, conteudo: string): string {
  const primeiraLinha = conteudo
    .split('\n')
    .find((linha) => linha.trim().length > 0);

  if (primeiraLinha && HEADING.test(primeiraLinha.trim())) {
    return conteudo;
  }

  return `# ${titulo}\n\n${conteudo}`;
}
