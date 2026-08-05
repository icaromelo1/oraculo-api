import { EventEmitter } from 'node:events';

export interface ProcessoFalso extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: jest.Mock;
}

export function criarProcessoFalso(): ProcessoFalso {
  const processo = new EventEmitter() as ProcessoFalso;

  processo.stdout = new EventEmitter();
  processo.stderr = new EventEmitter();
  processo.kill = jest.fn();

  return processo;
}
