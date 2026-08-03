import { CanActivate, Injectable } from '@nestjs/common';

@Injectable()
export class AuditoriaAcessoGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}
