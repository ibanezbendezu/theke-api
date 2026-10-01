import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ClerkAuthGuard } from './clerk-auth.guard.js';

@Injectable()
export class OptionalClerkAuthGuard implements CanActivate {
  constructor(@Inject(ClerkAuthGuard) private readonly required: ClerkAuthGuard) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{ headers: { authorization?: string } }>();
    if (!request.headers.authorization) return true;
    return this.required.canActivate(context);
  }
}
