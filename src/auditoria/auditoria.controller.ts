import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuditoriaAcessoGuard } from './auditoria-acesso.guard';
import { AuditoriaService } from './auditoria.service';
import { validarListarAuditoriaDto } from './dto/listar-auditoria.dto';

@UseGuards(AuditoriaAcessoGuard)
@Controller('auditoria')
export class AuditoriaController {
  constructor(private readonly auditoria: AuditoriaService) {}

  @Get()
  listar(@Query() query: unknown) {
    const filtro = validarListarAuditoriaDto(query);

    return this.auditoria.listar(filtro);
  }

  @Get('resumo')
  resumo() {
    return this.auditoria.resumo();
  }

  @Get('lacunas')
  lacunas() {
    return this.auditoria.lacunas();
  }

  @Get(':id')
  async detalhe(@Param('id') id: string) {
    const registro = await this.auditoria.buscarPorId(id);

    if (!registro) {
      throw new NotFoundException(
        `registro de auditoria "${id}" não encontrado`,
      );
    }

    return registro;
  }
}
