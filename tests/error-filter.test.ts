import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { HttpErrorFilter } from '../src/interfaces/http/http-exception.filter.js';
describe('errores HTTP', () => {
  it('devuelve 401 uniforme con requestId sin datos privados', () => {
    const send = vi.fn(); const header = vi.fn(); const status = vi.fn(() => ({ send }));
    const host = { switchToHttp: () => ({ getResponse: () => ({ status, header }), getRequest: () => ({ id: 'req-1' }) }) } as any;
    new HttpErrorFilter().catch(new UnauthorizedException('Sesión inválida'), host);
    expect(send).toHaveBeenCalledWith({ error: { code: 'UNAUTHORIZED', message: 'Sesión inválida', requestId: 'req-1' } });
    expect(header).toHaveBeenCalledWith('x-request-id', 'req-1');
  });
});
