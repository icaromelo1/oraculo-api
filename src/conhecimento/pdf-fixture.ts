export function pdfComTexto(texto = 'Texto do Oraculo'): Buffer {
  const fluxo = `BT /F1 12 Tf 40 700 Td (${texto}) Tj ET\n`;

  return montarPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${fluxo.length} >>\nstream\n${fluxo}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
}

export function pdfEscaneado(): Buffer {
  return montarPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << >> >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ]);
}

export function pdfCorrompido(): Buffer {
  return Buffer.from('%PDF-1.7\nlixo que nao e um pdf\n%%EOF\n', 'latin1');
}

function montarPdf(objetos: readonly string[]): Buffer {
  const partes: string[] = ['%PDF-1.4\n'];
  const deslocamentos: number[] = [];

  let deslocamento = partes[0].length;

  objetos.forEach((corpo, indice) => {
    const objeto = `${indice + 1} 0 obj\n${corpo}\nendobj\n`;

    deslocamentos.push(deslocamento);
    deslocamento += objeto.length;
    partes.push(objeto);
  });

  const inicioXref = deslocamento;
  const total = objetos.length + 1;

  const linhas = ['xref\n', `0 ${total}\n`, '0000000000 65535 f \n'];

  for (const posicao of deslocamentos) {
    linhas.push(`${String(posicao).padStart(10, '0')} 00000 n \n`);
  }

  partes.push(linhas.join(''));
  partes.push(
    `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`,
  );

  return Buffer.from(partes.join(''), 'latin1');
}
