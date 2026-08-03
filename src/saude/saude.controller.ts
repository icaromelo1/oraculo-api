import { Controller, Get } from '@nestjs/common';
import { OraculoConfig } from '../config/config.service';

@Controller('saude')
export class SaudeController {
  constructor(private readonly config: OraculoConfig) {}

  @Get()
  estado() {
    return {
      status: 'ok',
      ambiente: this.config.ambiente,
      provedor: this.config.provedor.tipo,
      recuperacao: this.config.recuperacao.modo,
      capacidades: this.config.capacidades,
    };
  }
}
