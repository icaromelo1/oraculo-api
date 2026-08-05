import { recortaInventario, recortarInventario } from './recorte-inventario';

const DOCKER_PS = [
  'servico=oraculo-api\timagem=oraculo-api\testado=Up 2 hours\tde_pe_ha=2 hours',
  'servico=kairos-api\timagem=kairos-api\testado=Up 5 days\tde_pe_ha=5 days',
  'servico=cast-postgres\timagem=postgres:17\testado=Up 3 weeks\tde_pe_ha=3 weeks',
  'servico=cast-keycloak\timagem=keycloak:18.0.0\testado=Up 3 weeks\tde_pe_ha=3 weeks',
  'servico=restore-mongodb\timagem=mongo:7\testado=Up 1 week\tde_pe_ha=1 week',
].join('\n');

const SS_LTNP = [
  'LISTEN 0 511 0.0.0.0:3000 0.0.0.0:* users:(("node",pid=2436324,fd=21))',
  'LISTEN 0 511 0.0.0.0:8080 0.0.0.0:* users:(("v1-front",pid=2432826,fd=18))',
  'LISTEN 0 244 127.0.0.1:5432 0.0.0.0:* users:(("postgres",pid=1234,fd=5))',
  'LISTEN 0 511 [::]:3010 [::]:* users:(("oraculo-api",pid=999,fd=23))',
].join('\n');

describe('recorte de inventário — só o que está cadastrado aparece', () => {
  const cadastrados = ['oraculo-api', 'kairos-api'];

  it('recorta apenas os dois ids de inventário', () => {
    expect(recortaInventario('servicos_ativos')).toBe(true);
    expect(recortaInventario('portas_escutando')).toBe(true);
    expect(recortaInventario('servico_logs')).toBe(false);
    expect(recortaInventario('recursos_maquina')).toBe(false);
  });

  it('não deixa nome de container de cliente vazar na listagem', () => {
    const saida = recortarInventario('servicos_ativos', DOCKER_PS, cadastrados);

    expect(saida).toContain('oraculo-api');
    expect(saida).toContain('kairos-api');
    expect(saida).not.toMatch(/cast-/);
    expect(saida).not.toContain('restore-mongodb');
    expect(saida).not.toContain('keycloak');
  });

  it('avisa quantos foram omitidos em vez de fingir que a máquina está vazia', () => {
    const saida = recortarInventario('servicos_ativos', DOCKER_PS, cadastrados);

    expect(saida).toContain('3 outro(s) serviço(s)');
  });

  it('preserva imagem e estado do serviço que está cadastrado', () => {
    const saida = recortarInventario('servicos_ativos', DOCKER_PS, cadastrados);

    expect(saida).toContain('imagem=kairos-api');
    expect(saida).toContain('estado=Up 5 days');
  });

  it('devolve recado claro quando nada cadastrado está de pé', () => {
    const saida = recortarInventario('servicos_ativos', DOCKER_PS, ['nada']);

    expect(saida).toContain('nenhum serviço cadastrado está de pé');
  });

  it('mantém a porta em escuta mas esconde o processo não cadastrado', () => {
    const saida = recortarInventario('portas_escutando', SS_LTNP, cadastrados);

    expect(saida).toContain('0.0.0.0:8080');
    expect(saida).toContain('127.0.0.1:5432');
    expect(saida).not.toContain('v1-front');
    expect(saida).not.toContain('pid=2432826');
    expect(saida).not.toContain('pid=1234');
  });

  it('preserva o processo quando ele está cadastrado', () => {
    const saida = recortarInventario('portas_escutando', SS_LTNP, cadastrados);

    expect(saida).toContain('"oraculo-api",pid=999');
  });

  it('não mexe na saída de ids que não são de inventário', () => {
    expect(recortarInventario('servico_logs', DOCKER_PS, [])).toBe(DOCKER_PS);
    expect(recortarInventario('recursos_maquina', SS_LTNP, [])).toBe(SS_LTNP);
  });

  it('sem nada cadastrado, nenhum processo sobrevive em portas_escutando', () => {
    const saida = recortarInventario('portas_escutando', SS_LTNP, []);

    expect(saida).not.toMatch(/pid=\d+/);
    expect(saida).toContain('0.0.0.0:3000');
  });
});
