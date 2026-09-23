import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createClerkClient } from '@clerk/backend';
import { parseEnvironmentList, requireEnvironment } from '../../config/environment.js';

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  private readonly clerk = createClerkClient({ secretKey: requireEnvironment('CLERK_SECRET_KEY'), publishableKey: requireEnvironment('CLERK_PUBLISHABLE_KEY') });
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const requestUrl = new URL(request.url, `${request.protocol}://${request.headers.host}`);
    const auth = await this.clerk.authenticateRequest(new Request(requestUrl, { headers: request.headers as Record<string, string> }), {
      jwtKey: requireEnvironment('CLERK_JWT_KEY'),
      authorizedParties: parseEnvironmentList('CLERK_AUTHORIZED_PARTIES'),
      acceptsToken: 'session_token',
    });
    if (!auth.isAuthenticated) throw new UnauthorizedException('Sesión ausente, vencida o no autorizada');
    request.authContext = { clerkUserId: auth.toAuth().userId };
    return true;
  }
}
