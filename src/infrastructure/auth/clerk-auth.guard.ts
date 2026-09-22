import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createClerkClient } from '@clerk/backend';

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  private readonly clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY, publishableKey: process.env.CLERK_PUBLISHABLE_KEY });
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const requestUrl = new URL(request.url, `${request.protocol}://${request.headers.host}`);
    const auth = await this.clerk.authenticateRequest(new Request(requestUrl, { headers: request.headers as Record<string, string> }), {
      jwtKey: process.env.CLERK_JWT_KEY,
      authorizedParties: (process.env.CLERK_AUTHORIZED_PARTIES ?? '').split(',').filter(Boolean),
      acceptsToken: 'session_token',
    });
    if (!auth.isAuthenticated) throw new UnauthorizedException('Sesión ausente, vencida o no autorizada');
    request.authContext = { clerkUserId: auth.toAuth().userId, email: null, displayName: null };
    return true;
  }
}
