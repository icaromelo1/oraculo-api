export interface MapaExibicao {
  de: string;
  para: string;
}

export function lerMapaExibicao(bruto: string[]): MapaExibicao[] {
  return bruto
    .map((par) => {
      const [de, para] = par.split('=');
      return de && para ? { de: de.trim(), para: para.trim() } : null;
    })
    .filter((item): item is MapaExibicao => item !== null)
    .sort((a, b) => b.de.length - a.de.length);
}

export function traduzirCaminho(caminho: string, mapa: MapaExibicao[]): string {
  for (const { de, para } of mapa) {
    if (caminho === de) {
      return para;
    }
    if (caminho.startsWith(de.endsWith('/') ? de : `${de}/`)) {
      return `${para.replace(/\/$/, '')}${caminho.slice(de.replace(/\/$/, '').length)}`;
    }
  }

  return caminho;
}
