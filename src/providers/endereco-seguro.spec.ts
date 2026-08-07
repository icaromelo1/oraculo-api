import {
  ehLinkLocal,
  resolverIpv4,
  validarEnderecoDeProvedor,
} from './endereco-seguro';

const recusa = (url: string) => {
  const veredicto = validarEnderecoDeProvedor(url);

  expect(veredicto.aprovado).toBe(false);

  return veredicto.aprovado ? '' : veredicto.motivo;
};

const aprova = (url: string) => {
  const veredicto = validarEnderecoDeProvedor(url);

  expect(veredicto).toMatchObject({ aprovado: true });

  return veredicto;
};

describe('endereco-seguro — link-local em qualquer forma', () => {
  it('recusa a forma pontuada', () => {
    expect(recusa('http://169.254.169.254/v1')).toMatch(/169\.254\.0\.0\/16/);
  });

  it('recusa a forma decimal de 32 bits', () => {
    expect(ehLinkLocal('2852039166')).toBe(true);
    recusa('http://2852039166/v1');
  });

  it('recusa a forma hexadecimal', () => {
    expect(ehLinkLocal('0xa9fea9fe')).toBe(true);
    expect(ehLinkLocal('0xA9FEA9FE')).toBe(true);
    recusa('http://0xa9fea9fe/v1');
  });

  it('recusa a forma octal', () => {
    expect(ehLinkLocal('0251.0376.0251.0376')).toBe(true);
    recusa('http://0251.0376.0251.0376/v1');
  });

  it('recusa a forma mista de menos de quatro partes', () => {
    expect(ehLinkLocal('169.254.43518')).toBe(true);
    expect(ehLinkLocal('169.16689662')).toBe(true);
    recusa('http://169.254.43518/v1');
  });

  it('recusa a forma hexadecimal octeto a octeto', () => {
    expect(ehLinkLocal('0xa9.0xfe.0xa9.0xfe')).toBe(true);
    recusa('http://0xa9.0xfe.0xa9.0xfe/v1');
  });

  it('não aceita como host o que nem é endereço válido', () => {
    expect(resolverIpv4('0xa9fe.0xa9fe')).toBeNull();
    recusa('http://0xa9fe.0xa9fe/v1');
  });

  it('recusa o IPv6 que mapeia o link-local', () => {
    expect(ehLinkLocal('::ffff:169.254.169.254')).toBe(true);
    expect(ehLinkLocal('::ffff:a9fe:a9fe')).toBe(true);
    expect(ehLinkLocal('0:0:0:0:0:ffff:a9fe:a9fe')).toBe(true);
    recusa('http://[::ffff:169.254.169.254]/v1');
    recusa('http://[::ffff:a9fe:a9fe]/v1');
  });

  it('recusa o hostname de metadados da Google', () => {
    expect(recusa('http://metadata.google.internal/v1')).toMatch(
      /metadados da instância/,
    );
    recusa('http://METADATA.GOOGLE.INTERNAL/v1');
    recusa('http://metadata.google.internal./v1');
  });

  it('recusa o link-local mesmo com porta e caminho', () => {
    recusa('http://169.254.169.254:8080/latest/meta-data/');
    recusa('https://169.254.0.1/v1');
    recusa('https://169.254.255.255/v1');
  });
});

describe('endereco-seguro — o que continua permitido', () => {
  it('aceita localhost e loopback, que é o caso do Ollama local', () => {
    expect(aprova('http://localhost:11434/v1')).toMatchObject({
      host: 'localhost',
    });
    aprova('http://127.0.0.1:11434/v1');
    aprova('http://[::1]:11434/v1');
  });

  it('aceita as faixas privadas', () => {
    aprova('http://10.0.0.5:8000/v1');
    aprova('http://172.16.3.9:8000/v1');
    aprova('http://192.168.1.20:8000/v1');
  });

  it('aceita endpoint público com https', () => {
    aprova('https://api.openai.com/v1');
  });

  it('não confunde vizinho de faixa com link-local', () => {
    expect(ehLinkLocal('169.253.169.254')).toBe(false);
    expect(ehLinkLocal('169.255.0.1')).toBe(false);
    expect(ehLinkLocal('16.9.254.1')).toBe(false);
    aprova('https://169.253.169.254/v1');
  });
});

describe('endereco-seguro — forma da URL', () => {
  it('exige http ou https', () => {
    expect(recusa('file:///etc/passwd')).toMatch(/http ou https/);
    expect(recusa('ftp://exemplo.com/v1')).toMatch(/http ou https/);
    expect(recusa('gopher://169.254.169.254/')).toMatch(/http ou https/);
  });

  it('recusa texto que não é URL', () => {
    recusa('api.openai.com/v1');
    recusa('   ');
  });
});

describe('resolverIpv4 — só reconhece endereço, não hostname', () => {
  it('devolve nulo para hostname', () => {
    expect(resolverIpv4('api.openai.com')).toBeNull();
    expect(resolverIpv4('localhost')).toBeNull();
    expect(resolverIpv4('169.254.169.254.exemplo.com')).toBeNull();
  });

  it('devolve nulo para octeto fora da faixa', () => {
    expect(resolverIpv4('169.254.169.256')).toBeNull();
    expect(resolverIpv4('999.999.999.999')).toBeNull();
    expect(resolverIpv4('08.1.1.1')).toBeNull();
  });

  it('não trata IPv6 comum como IPv4', () => {
    expect(resolverIpv4('2001:db8::1')).toBeNull();
    expect(resolverIpv4('::1')).toBeNull();
  });
});
