const JANELA_DE_AMOSTRA = 8000;

export function pareceBinario(buffer: Buffer): boolean {
  const limite = Math.min(buffer.length, JANELA_DE_AMOSTRA);

  for (let indice = 0; indice < limite; indice += 1) {
    if (buffer[indice] === 0) {
      return true;
    }
  }

  return false;
}
