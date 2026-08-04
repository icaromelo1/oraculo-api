import { CifraService, mascararHost, resumirUrl } from './cifra.service';
import { OraculoConfig } from './config.service';

function cifraFalsa(
  segredo = 'segredo-de-teste-com-32-caracteres-ok',
): CifraService {
  return new CifraService({
    segredoDeConfiguracao: segredo,
  } as OraculoConfig);
}

describe('CifraService', () => {
  const url = 'postgres://oraculo:senhaSuperSecreta@10.0.0.7:5432/producao';

  it('cifra e decifra de volta o valor original', () => {
    const cifra = cifraFalsa();
    const guardado = cifra.cifrar(url);

    expect(guardado).not.toContain('senhaSuperSecreta');
    expect(guardado.startsWith('v1:')).toBe(true);
    expect(cifra.decifrar(guardado)).toBe(url);
  });

  it('gera texto cifrado diferente a cada chamada', () => {
    const cifra = cifraFalsa();

    expect(cifra.cifrar(url)).not.toBe(cifra.cifrar(url));
  });

  it('recusa valor adulterado', () => {
    const cifra = cifraFalsa();
    const [versao, iv, marca, corpo] = cifra.cifrar(url).split(':');
    const adulterado = [versao, iv, marca, `${corpo.slice(0, -4)}AAAA`].join(
      ':',
    );

    expect(() => cifra.decifrar(adulterado)).toThrow();
  });

  it('não decifra com outro segredo', () => {
    const guardado = cifraFalsa().cifrar(url);

    expect(() =>
      cifraFalsa('outro-segredo-com-32-caracteres-aqui').decifrar(guardado),
    ).toThrow();
  });

  it('resume a conexão sem devolver a credencial', () => {
    const resumo = resumirUrl(url);

    expect(resumo.usuario).toBe('oraculo');
    expect(resumo.base).toBe('producao');
    expect(resumo.porta).toBe('5432');
    expect(JSON.stringify(resumo)).not.toContain('senhaSuperSecreta');
    expect(resumo.host).not.toBe('10.0.0.7');
  });

  it('mascara host de domínio e de ip', () => {
    expect(mascararHost('10.0.0.7')).toBe('10.0.•.•');
    expect(mascararHost('banco-producao.interno.br')).toBe(
      'ba••••••••••••.interno.br',
    );
  });

  it('resume valor ilegível sem estourar', () => {
    const cifra = cifraFalsa();

    expect(cifra.resumir('lixo-nao-cifrado').host).toBe('(host indisponível)');
  });
});
