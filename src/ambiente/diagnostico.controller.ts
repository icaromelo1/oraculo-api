import { Controller, Get } from '@nestjs/common';
import {
  DiagnosticoCapacidade,
  type CatalogoExibido,
} from '../capabilities/diagnostico';

@Controller('ambiente/diagnostico')
export class DiagnosticoController {
  constructor(private readonly capacidade: DiagnosticoCapacidade) {}

  @Get('catalogo')
  catalogo(): CatalogoExibido {
    return this.capacidade.catalogoParaAuditoria();
  }
}
