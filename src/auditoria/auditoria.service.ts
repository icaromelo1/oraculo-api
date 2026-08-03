import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { Aprovacao, Auditoria, StatusAprovacao } from '../database/entities';
import type { ListarAuditoriaDto } from './dto/listar-auditoria.dto';
import {
  CATEGORIA_RESULTADO_SQL,
  formatarInteiro,
  mapearDetalhe,
  mapearRegistro,
} from './mapeamento';
import type { CartaoResumo, ListaAuditoria, RegistroAuditoria } from './tipos';

const JANELA_RESUMO_HORAS = 24;
const TONS_DE_BLOQUEIO_DEDICADO = ['bloqueio', 'aprovacao_exigida'];

@Injectable()
export class AuditoriaService {
  constructor(
    @InjectRepository(Auditoria)
    private readonly auditorias: Repository<Auditoria>,
    @InjectRepository(Aprovacao)
    private readonly aprovacoes: Repository<Aprovacao>,
  ) {}

  async listar(filtro: ListarAuditoriaDto): Promise<ListaAuditoria> {
    const consulta = this.auditorias
      .createQueryBuilder('auditoria')
      .leftJoinAndSelect('auditoria.usuario', 'usuario')
      .leftJoinAndSelect('usuario.perfil', 'perfil')
      .orderBy('auditoria.criadaEm', 'DESC');

    if (filtro.busca) {
      consulta.andWhere(
        '(usuario.login ILIKE :busca OR usuario.nome ILIKE :busca OR auditoria.pergunta ILIKE :busca OR auditoria.resultado ILIKE :busca)',
        { busca: `%${filtro.busca}%` },
      );
    }

    if (filtro.ferramenta) {
      consulta.andWhere(
        `EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(auditoria.ferramentas -> 'itens', '[]'::jsonb)) AS item
          WHERE item ->> 'nome' = :ferramenta
          UNION ALL
          SELECT 1 FROM jsonb_array_elements(COALESCE(auditoria.bloqueios -> 'itens', '[]'::jsonb)) AS item
          WHERE item ->> 'capacidade' = :ferramenta
        )`,
        { ferramenta: filtro.ferramenta },
      );
    }

    if (filtro.resultado) {
      consulta.andWhere(`(${CATEGORIA_RESULTADO_SQL}) = :categoria`, {
        categoria: filtro.resultado,
      });
    }

    if (filtro.de) {
      consulta.andWhere('auditoria.criadaEm >= :de', { de: filtro.de });
    }

    if (filtro.ate) {
      consulta.andWhere('auditoria.criadaEm <= :ate', { ate: filtro.ate });
    }

    const [linhas, total] = await consulta
      .skip((filtro.pagina - 1) * filtro.porPagina)
      .take(filtro.porPagina)
      .getManyAndCount();

    return {
      registros: linhas.map(mapearRegistro),
      total,
      pagina: filtro.pagina,
      porPagina: filtro.porPagina,
    };
  }

  async buscarPorId(id: string): Promise<RegistroAuditoria | null> {
    const auditoria = await this.auditorias.findOne({
      where: { id },
      relations: { usuario: { perfil: true } },
    });

    return auditoria ? mapearDetalhe(auditoria) : null;
  }

  async resumo(): Promise<CartaoResumo[]> {
    const desde = new Date(Date.now() - JANELA_RESUMO_HORAS * 60 * 60 * 1000);

    const [consultas, ferramentasExecutadas, bloqueios, aprovacoesPendentes] =
      await Promise.all([
        this.auditorias.count({
          where: {
            criadaEm: MoreThanOrEqual(desde),
            tom: Not(In(TONS_DE_BLOQUEIO_DEDICADO)),
          },
        }),
        this.contarFerramentasExecutadas(desde),
        this.auditorias.count({
          where: { criadaEm: MoreThanOrEqual(desde), tom: 'bloqueio' },
        }),
        this.aprovacoes.count({
          where: { status: StatusAprovacao.PENDENTE },
        }),
      ]);

    return [
      {
        rotulo: 'consultas · 24 h',
        valor: formatarInteiro(consultas),
        tom: 'neutro',
      },
      {
        rotulo: 'ferramentas executadas',
        valor: formatarInteiro(ferramentasExecutadas),
        tom: 'neutro',
      },
      {
        rotulo: 'bloqueios por permissão',
        valor: formatarInteiro(bloqueios),
        tom: bloqueios > 0 ? 'erro' : 'neutro',
      },
      {
        rotulo: 'aprovações pendentes',
        valor: formatarInteiro(aprovacoesPendentes),
        tom: aprovacoesPendentes > 0 ? 'aviso' : 'neutro',
      },
    ];
  }

  private async contarFerramentasExecutadas(desde: Date): Promise<number> {
    const linhas: unknown = await this.auditorias.manager.query(
      `SELECT COUNT(*)::int AS total
       FROM auditoria a, jsonb_array_elements(COALESCE(a.ferramentas -> 'itens', '[]'::jsonb)) AS item
       WHERE a.criada_em >= $1 AND item ->> 'status' IN ('concluida', 'erro')`,
      [desde],
    );

    const primeira = Array.isArray(linhas)
      ? (linhas[0] as { total?: number } | undefined)
      : undefined;

    return Number(primeira?.total ?? 0);
  }
}
