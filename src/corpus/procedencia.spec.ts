import { classificar } from '../engine/fonte';
import {
  calcularHash,
  construirProcedencia,
  extrairTitulo,
  inferirFonte,
} from './procedencia';

describe('inferirFonte', () => {
  it('reconhece nota escrita pelo dono com autoridade 1', () => {
    expect(inferirFonte('/corpus/notas/analise-do-deposito.md')).toEqual({
      fonte: 'nota',
      autoridade: 1,
    });
    expect(
      inferirFonte('/home/ubuntu/oraculo-notas/notas/reuniao-2.md'),
    ).toEqual({ fonte: 'nota', autoridade: 1 });
  });

  it('não confunde markdown fora do diretório de notas com nota', () => {
    expect(inferirFonte('/corpus/projects/notas.md')).toEqual({
      fonte: 'doc',
      autoridade: 2,
    });
    expect(inferirFonte('/corpus/notas/sub/nota.md')).toEqual({
      fonte: 'doc',
      autoridade: 2,
    });
  });

  it('reconhece memória do Claude', () => {
    expect(
      inferirFonte(
        '/home/ubuntu/.claude/projects/-home-ubuntu/memory/reference_x.md',
      ),
    ).toEqual({ fonte: 'memoria', autoridade: 1 });
  });

  it('reconhece agentes/skills', () => {
    expect(
      inferirFonte(
        '/home/ubuntu/claude-workspace-config/skills/commit-qa/SKILL.md',
      ),
    ).toEqual({ fonte: 'agente', autoridade: 1 });
    expect(
      inferirFonte('/home/ubuntu/claude-workspace-config/agents/foo.md'),
    ).toEqual({ fonte: 'agente', autoridade: 1 });
  });

  it('reconhece configuração viva', () => {
    expect(inferirFonte('/home/ubuntu/infra/docker-compose.yml')).toEqual({
      fonte: 'config',
      autoridade: 3,
    });
    expect(inferirFonte('/etc/nginx/nginx.conf')).toEqual({
      fonte: 'config',
      autoridade: 3,
    });
  });

  it('classifica markdown genérico como doc', () => {
    expect(inferirFonte('/home/ubuntu/oraculo-workspace/docs/x.md')).toEqual({
      fonte: 'doc',
      autoridade: 2,
    });
  });

  it('classifica o restante como código', () => {
    expect(inferirFonte('/home/ubuntu/projects/api/src/main.ts')).toEqual({
      fonte: 'codigo',
      autoridade: 3,
    });
  });
});

describe('extrairTitulo', () => {
  it('usa o primeiro heading do markdown', () => {
    expect(extrairTitulo('/x/doc.md', '# Meu Título\ntexto')).toBe(
      'Meu Título',
    );
  });

  it('usa o nome do arquivo quando não há heading', () => {
    expect(extrairTitulo('/x/main.ts', 'const a = 1;')).toBe('main.ts');
  });
});

describe('calcularHash', () => {
  it('é determinístico e sensível ao conteúdo', () => {
    expect(calcularHash('a')).toBe(calcularHash('a'));
    expect(calcularHash('a')).not.toBe(calcularHash('b'));
  });
});

describe('construirProcedencia', () => {
  it('combina fonte, autoridade, título e hash', () => {
    const procedencia = construirProcedencia('/x/doc.md', '# T\ntexto');

    expect(procedencia).toEqual({
      fonte: 'doc',
      autoridade: 2,
      titulo: 'T',
      hash: calcularHash('# T\ntexto'),
    });
  });
});

describe('a nota chega ao front como fonte curada', () => {
  it('mantém autoridade 1 da procedência até o contrato de eventos', () => {
    const { fonte, autoridade } = inferirFonte('/corpus/notas/minha-nota.md');

    expect(autoridade).toBe(1);
    expect(classificar(fonte)).toBe('curado');
  });
});

describe('procedência com caminhos do container', () => {
  it('reconhece agentes montados como claude-workspace-config', () => {
    expect(
      inferirFonte('/corpus/claude-workspace-config/workspace-agents/x.md'),
    ).toEqual({ fonte: 'agente', autoridade: 1 });
  });

  it('reconhece a memória sincronizada em oraculo-workspace/memoria', () => {
    expect(
      inferirFonte('/corpus/oraculo-workspace/memoria/feedback_x.md'),
    ).toEqual({ fonte: 'memoria', autoridade: 1 });
  });

  it('continua reconhecendo a memória no caminho original do Claude', () => {
    expect(
      inferirFonte('/corpus/.claude/projects/-home-ubuntu/memory/y.md'),
    ).toEqual({ fonte: 'memoria', autoridade: 1 });
  });
});

describe('memória versionada dentro do claude-workspace-config', () => {
  it('reconhece como memória com autoridade 1', () => {
    expect(
      inferirFonte(
        '/corpus/claude-workspace-config/memory/-Volumes-icaro/feedback_x.md',
      ),
    ).toEqual({ fonte: 'memoria', autoridade: 1 });
  });

  it('continua reconhecendo o espelho e o caminho do claude', () => {
    expect(inferirFonte('/corpus/oraculo-workspace/memoria/a.md').fonte).toBe(
      'memoria',
    );
    expect(
      inferirFonte('/corpus/.claude/projects/-slug/memory/b.md').fonte,
    ).toBe('memoria');
  });

  it('não confunde skills com memória', () => {
    expect(
      inferirFonte('/corpus/claude-workspace-config/skills/commit/SKILL.md')
        .fonte,
    ).toBe('agente');
  });
});
