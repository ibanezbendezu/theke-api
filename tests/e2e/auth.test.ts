import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { ClerkAuthGuard } from '../../src/infrastructure/auth/clerk-auth.guard.js';
import { HttpErrorFilter } from '../../src/interfaces/http/http-exception.filter.js';
import { MeController } from '../../src/interfaces/http/me.controller.js';

beforeEach(() => {
  vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_value');
  vi.stubEnv('CLERK_PUBLISHABLE_KEY', 'pk_test_value');
  vi.stubEnv('CLERK_JWT_KEY', 'jwt-key');
  vi.stubEnv('CLERK_AUTHORIZED_PARTIES', ' https://app.test, https://preview.test ');
});
afterEach(() => vi.unstubAllEnvs());

describe('frontera HTTP de autenticación', () => {
  it('rechaza un token inválido antes de invocar aprovisionamiento o base de datos', async () => {
    const guard = new ClerkAuthGuard();
    (guard as any).clerk = { authenticateRequest: vi.fn(async () => ({ isAuthenticated: false })) };
    const request = { url: '/v1/me', protocol: 'https', headers: { host: 'api.test', authorization: 'Bearer invalid' } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as any;
    const provisionAfterGuard = vi.fn();
    await expect(guard.canActivate(context).then(provisionAfterGuard)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(provisionAfterGuard).not.toHaveBeenCalled();
  });
  it('propaga el Clerk user id autenticado al controlador y devuelve el envelope esperado', async () => {
    const guard = new ClerkAuthGuard();
    (guard as any).clerk = { authenticateRequest: vi.fn(async (_request: unknown, options: { authorizedParties: string[] }) => {
      expect(options.authorizedParties).toEqual(['https://app.test', 'https://preview.test']);
      return { isAuthenticated: true, toAuth: () => ({ userId: 'clerk_user_123' }) };
    }) };
    const request: any = { url: '/v1/me', protocol: 'https', headers: { host: 'api.test', authorization: 'Bearer valid' } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as any;
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.authContext).toEqual({ clerkUserId: 'clerk_user_123' });

    const identity = { user: { id: 'u1', email: null, displayName: null }, account: { id: 'a1', name: 'Mi espacio Theke' }, membership: { id: 'm1', role: 'owner' as const } };
    const ensureLocalUser = vi.fn(async () => identity);
    const response = await new MeController({ ensureLocalUser } as any).me(request.authContext);
    expect(ensureLocalUser).toHaveBeenCalledWith(request.authContext);
    expect(response).toEqual({ data: identity });
  });
  it('correlaciona el mismo Fastify request.id en header y envelope de error', () => {
    const send = vi.fn(); const header = vi.fn(); const status = vi.fn(() => ({ send }));
    const host = { switchToHttp: () => ({ getResponse: () => ({ status, header }), getRequest: () => ({ id: 'req-e2e-1' }) }) } as any;
    new HttpErrorFilter().catch(new UnauthorizedException('Sesión inválida'), host);
    expect(header).toHaveBeenCalledWith('x-request-id', 'req-e2e-1');
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ requestId: 'req-e2e-1' }) }));
  });
});
