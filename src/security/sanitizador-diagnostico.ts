import { Injectable } from '@nestjs/common';
import { RedactionService } from './redaction.service';
import type { OcorrenciaRedacao } from './tipos';

export interface ResultadoSanitizacao {
  texto: string;
  ocorrencias: OcorrenciaRedacao[];
}

@Injectable()
export class SanitizadorDiagnostico {
  constructor(private readonly redacao: RedactionService) {}

  sanitizar(bruto: string): ResultadoSanitizacao {
    const { texto, ocorrencias } = this.redacao.redigirDiagnostico(bruto);

    return { texto, ocorrencias };
  }
}
