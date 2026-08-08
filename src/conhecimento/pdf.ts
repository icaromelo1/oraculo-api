import { extname } from 'node:path';
import { extractText, getDocumentProxy } from 'unpdf';

const ASSINATURA_PDF = '%PDF-';
const BYTE_NULO = String.fromCharCode(0);

export type ExtracaoDePdf =
  | { aceito: true; texto: string; paginas: number }
  | { aceito: false; motivo: string };

export function pareceDocumentoPdf(
  nome: string,
  mimetype: string | undefined,
  buffer: Buffer,
): boolean {
  if (extname(nome).toLowerCase() === '.pdf') return true;
  if (mimetype === 'application/pdf') return true;

  return (
    buffer.subarray(0, ASSINATURA_PDF.length).toString('latin1') ===
    ASSINATURA_PDF
  );
}

export async function extrairTextoDePdf(
  nome: string,
  buffer: Buffer,
): Promise<ExtracaoDePdf> {
  let documento: Awaited<ReturnType<typeof getDocumentProxy>> | null = null;

  try {
    documento = await getDocumentProxy(new Uint8Array(buffer));

    const { text, totalPages } = await extractText(documento, {
      mergePages: true,
    });

    const limpo = text.split(BYTE_NULO).join('').trim();

    if (!limpo) {
      return { aceito: false, motivo: motivoDeEscaneado(nome) };
    }

    return { aceito: true, texto: limpo, paginas: totalPages };
  } catch (erro) {
    return { aceito: false, motivo: motivoDeIlegivel(nome, erro) };
  } finally {
    await encerrar(documento);
  }
}

async function encerrar(
  documento: Awaited<ReturnType<typeof getDocumentProxy>> | null,
): Promise<void> {
  try {
    await documento?.loadingTask?.destroy();
  } catch {
    return;
  }
}

export function mensagemDoErro(erro: unknown): string {
  if (typeof erro === 'string') return erro;

  if (erro !== null && typeof erro === 'object' && 'message' in erro) {
    return String(erro.message);
  }

  return String(erro);
}

function motivoDeEscaneado(nome: string): string {
  return (
    `"${nome}" é um PDF digitalizado: as páginas são imagem e não têm camada de texto para extrair. ` +
    'O Oráculo não faz OCR — passe o arquivo por um OCR antes de enviar, ou cole o texto como nota.'
  );
}

function motivoDeIlegivel(nome: string, erro: unknown): string {
  return (
    `"${nome}" não pôde ser lido como PDF — arquivo inválido ou corrompido ` +
    `(${mensagemDoErro(erro)})`
  );
}
