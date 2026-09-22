import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { ClerkAuthGuard } from '../../src/infrastructure/auth/clerk-auth.guard.js';
import { HttpErrorFilter } from '../../src/interfaces/http/http-exception.filter.js';

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
  it('correlaciona el mismo Fastify request.id en header y envelope de error', () => {
    const send = vi.fn(); const header = vi.fn(); const status = vi.fn(() => ({ send }));
    const host = { switchToHttp: () => ({ getResponse: () => ({ status, header }), getRequest: () => ({ id: 'req-e2e-1' }) }) } as any;
    new HttpErrorFilter().catch(new UnauthorizedException('Sesión inválida'), host);
    expect(header).toHaveBeenCalledWith('x-request-id', 'req-e2e-1');
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ requestId: 'req-e2e-1' }) }));
  });
});
