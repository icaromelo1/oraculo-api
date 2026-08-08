jest.mock('unpdf', () => {
  const real =
    jest.requireActual<typeof import('./unpdf-real')>('./unpdf-real');

  return real.delegarParaUnpdfReal();
});

import { pdfComTexto, pdfCorrompido, pdfEscaneado } from './pdf-fixture';
import { extrairTextoDePdf, mensagemDoErro, pareceDocumentoPdf } from './pdf';

describe('pareceDocumentoPdf', () => {
  it('reconhece pela extensão, pelo mimetype e pela assinatura do conteúdo', () => {
    const texto = Buffer.from('# nota', 'utf-8');

    expect(pareceDocumentoPdf('contrato.PDF', undefined, texto)).toBe(true);
    expect(pareceDocumentoPdf('sem-extensao', 'application/pdf', texto)).toBe(
      true,
    );
    expect(
      pareceDocumentoPdf('disfarce.md', 'text/markdown', pdfComTexto()),
    ).toBe(true);
    expect(pareceDocumentoPdf('nota.md', 'text/markdown', texto)).toBe(false);
  });
});

describe('extrairTextoDePdf', () => {
  it('extrai o texto de um PDF que tem camada de texto', async () => {
    const extracao = await extrairTextoDePdf(
      'guia.pdf',
      pdfComTexto('Deposito Antecipado'),
    );

    expect(extracao.aceito).toBe(true);

    if (!extracao.aceito) return;

    expect(extracao.texto).toContain('Deposito Antecipado');
    expect(extracao.paginas).toBe(1);
  });

  it('recusa PDF digitalizado, que não tem texto nenhum, explicando o motivo', async () => {
    const extracao = await extrairTextoDePdf('escaneado.pdf', pdfEscaneado());

    expect(extracao.aceito).toBe(false);

    if (extracao.aceito) return;

    expect(extracao.motivo).toContain('escaneado.pdf');
    expect(extracao.motivo).toContain('imagem');
    expect(extracao.motivo).toContain('OCR');
  });

  it('recusa PDF corrompido com erro tratado, sem lançar', async () => {
    const extracao = await extrairTextoDePdf('quebrado.pdf', pdfCorrompido());

    expect(extracao.aceito).toBe(false);

    if (extracao.aceito) return;

    expect(extracao.motivo).toContain('quebrado.pdf');
    expect(extracao.motivo).toContain('corrompido');
    expect(extracao.motivo).toContain('Invalid PDF structure');
  });
});

describe('mensagemDoErro', () => {
  it('lê a mensagem de erro de outro realm, sem depender de instanceof', () => {
    expect(mensagemDoErro(new Error('quebrou'))).toBe('quebrou');
    expect(mensagemDoErro({ message: 'de outro realm' })).toBe(
      'de outro realm',
    );
    expect(mensagemDoErro('texto solto')).toBe('texto solto');
    expect(mensagemDoErro(null)).toBe('null');
  });
});
