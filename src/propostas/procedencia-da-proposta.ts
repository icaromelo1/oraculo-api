export interface ProcedenciaDaProposta {
  origemCaminho: string | null;
  justificativa: string;
  descobertaEm: Date;
  aprovadaEm: Date;
  aprovadaPor: string | null;
}

export const TITULO_DA_PROCEDENCIA = '## Procedência';

const SEM_ORIGEM = 'não informada';
const SEM_APROVADOR = 'usuário não identificado';

function instante(data: Date): string {
  return data instanceof Date && !Number.isNaN(data.getTime())
    ? data.toISOString()
    : 'data desconhecida';
}

function umaLinha(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim();
}

export function montarProcedencia(procedencia: ProcedenciaDaProposta): string {
  const justificativa = umaLinha(procedencia.justificativa ?? '');

  const linhas = [
    TITULO_DA_PROCEDENCIA,
    '',
    'Este conteúdo nasceu de uma proposta do Oráculo e foi gravado só depois de aprovação humana — não foi escrito à mão pelo dono da instalação.',
    '',
    `- Origem da descoberta: ${procedencia.origemCaminho?.trim() || SEM_ORIGEM}`,
    `- Descoberta em: ${instante(procedencia.descobertaEm)}`,
    `- Aprovada por: ${procedencia.aprovadaPor?.trim() || SEM_APROVADOR}`,
    `- Aprovada em: ${instante(procedencia.aprovadaEm)}`,
  ];

  if (justificativa) {
    linhas.push(`- Justificativa da proposta: ${justificativa}`);
  }

  return linhas.join('\n');
}

function neutralizarProcedenciaFalsa(conteudo: string): string {
  return conteudo
    .split('\n')
    .map((linha) =>
      /^\s*#{1,6}\s*Proced[êe]ncia\s*$/i.test(linha)
        ? linha.replace(/^(\s*)#{1,6}/, '$1')
        : linha,
    )
    .join('\n');
}

export function comProcedencia(
  conteudo: string,
  procedencia: ProcedenciaDaProposta,
): string {
  const corpo = neutralizarProcedenciaFalsa(
    (conteudo ?? '').replace(/\s+$/, ''),
  );

  return `${corpo}\n\n---\n\n${montarProcedencia(procedencia)}\n`;
}
