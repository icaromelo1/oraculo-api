import { lerMapaExibicao, traduzirCaminho } from './caminho-exibicao';

describe('caminho de exibição', () => {
  const mapa = lerMapaExibicao([
    '/corpus/claude-projects=/home/ubuntu/.claude/projects',
    '/corpus/workspace-config=/home/ubuntu/claude-workspace-config',
    '/corpus/oraculo-workspace/repos=/home/ubuntu/oraculo-workspace/repos',
    '/corpus=/home/ubuntu',
  ]);

  it('traduz o prefixo do container para o caminho do host', () => {
    expect(
      traduzirCaminho('/corpus/workspace-config/agents/tech-lead.md', mapa),
    ).toBe('/home/ubuntu/claude-workspace-config/agents/tech-lead.md');
  });

  it('usa o mapeamento mais específico quando há sobreposição', () => {
    expect(
      traduzirCaminho('/corpus/oraculo-workspace/repos/kairos/README.md', mapa),
    ).toBe('/home/ubuntu/oraculo-workspace/repos/kairos/README.md');
  });

  it('traduz o próprio prefixo sem sufixo', () => {
    expect(traduzirCaminho('/corpus/workspace-config', mapa)).toBe(
      '/home/ubuntu/claude-workspace-config',
    );
  });

  it('não toca em caminho que não casa com nenhum prefixo', () => {
    expect(traduzirCaminho('/tmp/outro/arquivo.md', mapa)).toBe(
      '/tmp/outro/arquivo.md',
    );
  });

  it('não confunde prefixo parcial de nome de pasta', () => {
    expect(traduzirCaminho('/corpus-outro/arquivo.md', mapa)).toBe(
      '/corpus-outro/arquivo.md',
    );
  });

  it('ignora entrada malformada do mapa', () => {
    expect(lerMapaExibicao(['sem-igual', '=vazio', 'de=para'])).toEqual([
      { de: 'de', para: 'para' },
    ]);
  });
});
