import { caminhoNegado, ehDoProprioOraculo } from './denylist';

describe('o Oráculo não indexa a si mesmo', () => {
  const proprios = [
    'projects/oraculo-api/src/security/redaction.service.ts',
    'projects/oraculo-api/src/capabilities/diagnostico/catalogo.ts',
    'projects/oraculo-ui/src/pages/AmbientePage.vue',
    'projects/oraculo/site/index.html',
    'memory/-Volumes-icaro/project_oraculo_no_ar_vm.md',
    'memory/-Volumes-icaro/project_oraculo_rag_vm.md',
  ];

  const alheios = [
    'oraculo-workspace/memoria/feedback_branch_naming.md',
    'oraculo-workspace/docs/MANUTENCAO.md',
    'notas/porta-do-kairos.md',
    'projects/kairos-api/src/main.ts',
    'claude-workspace-config/skills/commit/SKILL.md',
    'infra/docker-compose.yml',
  ];

  it.each(proprios)('recusa %s mesmo sem denylist configurada', (caminho) => {
    expect(caminhoNegado(caminho, [])).toBe(true);
    expect(ehDoProprioOraculo(caminho)).toBe(true);
  });

  it.each(alheios)('continua aceitando %s', (caminho) => {
    expect(caminhoNegado(caminho, [])).toBe(false);
    expect(ehDoProprioOraculo(caminho)).toBe(false);
  });
});
