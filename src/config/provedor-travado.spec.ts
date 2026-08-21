import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ForbiddenException } from '@nestjs/common';
import { ConfiguracaoService } from './configuracao.service';

/**
 * A trava vive no serviço, não no controller: é o único ponto por onde as três
 * escritas passam. Estes testes provam que nenhuma delas escapa, e que a leitura
 * continua livre — quem clonar o Oráculo precisa VER a configuração.
 */
function servicoCom(travado: boolean): ConfiguracaoService {
  const servico = Object.create(
    ConfiguracaoService.prototype,
  ) as ConfiguracaoService;

  Object.defineProperty(servico, 'config', {
    value: { provedorTravado: travado },
    writable: false,
  });

  return servico;
}

function exigir(servico: ConfiguracaoService, acao: string): void {
  (
    servico as unknown as { exigirProvedorDestravado(acao: string): void }
  ).exigirProvedorDestravado(acao);
}

describe('provedor travado pelo .env', () => {
  it('destravado deixa passar toda escrita', () => {
    const servico = servicoCom(false);

    for (const acao of [
      'cadastrar provedor',
      'trocar o provedor ativo',
      'remover provedor',
    ]) {
      expect(() => exigir(servico, acao)).not.toThrow();
    }
  });

  it('travado recusa toda escrita', () => {
    const servico = servicoCom(true);

    for (const acao of [
      'cadastrar provedor',
      'trocar o provedor ativo',
      'remover provedor',
    ]) {
      expect(() => exigir(servico, acao)).toThrow(ForbiddenException);
    }
  });

  it('a recusa diz o que fazer, não só que não pode', () => {
    const servico = servicoCom(true);

    try {
      exigir(servico, 'cadastrar provedor');
      throw new Error('deveria ter recusado');
    } catch (falha) {
      const mensagem = (falha as Error).message;

      expect(mensagem).toContain('cadastrar provedor');
      expect(mensagem).toContain('PROVEDOR_TRAVADO');
      expect(mensagem).toContain('.env');
      expect(mensagem.toLowerCase()).toContain('reinicie');
    }
  });

  it('toda escrita de provedor no serviço passa pela guarda', () => {
    // O risco que a guarda existe para cobrir é rota nova esquecer de chamá-la.
    // Este teste falha quando alguém adiciona uma escrita e não põe a guarda.
    const fonte = readFileSync(
      join(__dirname, 'configuracao.service.ts'),
      'utf-8',
    );
    const escritas = ['criarProvedor', 'ativarProvedor', 'removerProvedor'];

    for (const metodo of escritas) {
      const inicio = fonte.indexOf(`async ${metodo}(`);

      expect(inicio).toBeGreaterThan(-1);

      const corpo = fonte.slice(inicio, inicio + 600);

      expect(corpo).toContain('exigirProvedorDestravado');
    }
  });
});
