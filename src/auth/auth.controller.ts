import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { PerfilCapacidade, StatusPerfilCapacidade } from '../database/entities';
import { AUTENTICADOR } from './autenticador';
import type { Autenticador } from './autenticador';
import { validarEntrarDto } from './dto/entrar.dto';
import { Publico } from './publico.decorator';
import type { RequisicaoAutenticada } from './requisicao-autenticada';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AUTENTICADOR) private readonly autenticador: Autenticador,
    @InjectRepository(PerfilCapacidade)
    private readonly capacidades: Repository<PerfilCapacidade>,
  ) {}

  @Publico()
  @HttpCode(200)
  @Post('entrar')
  entrar(@Body() corpo: unknown) {
    const dto = validarEntrarDto(corpo);
    return this.autenticador.autenticar(dto.login, dto.senha);
  }

  @Get('eu')
  async eu(@Req() requisicao: RequisicaoAutenticada) {
    const capacidadesDoPerfil = await this.capacidades.find({
      where: {
        perfil: { id: requisicao.usuario.perfil.id },
        status: Not(StatusPerfilCapacidade.NEGADA),
      },
    });

    return {
      usuario: requisicao.usuario,
      capacidades: capacidadesDoPerfil.map((capacidade) => ({
        capacidade: capacidade.capacidade,
        status: capacidade.status,
        escopo: capacidade.escopo,
      })),
    };
  }
}
