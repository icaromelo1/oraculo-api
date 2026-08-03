import { SetMetadata } from '@nestjs/common';

export const PUBLICO_KEY = 'publico';

export const Publico = () => SetMetadata(PUBLICO_KEY, true);
