import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseEnvironmentList, validateEnvironment } from '../src/config/environment.js';

afterEach(() => vi.unstubAllEnvs());

describe('configuración segura', () => {
  it('recorta listas y descarta entradas vacías', () => {
    vi.stubEnv('WEB_ORIGINS', ' https://app.test, ,https://preview.test ');
    expect(parseEnvironmentList('WEB_ORIGINS')).toEqual(['https://app.test', 'https://preview.test']);
  });

  it('falla cerrado cuando falta configuración crítica', () => {
    for (const key of ['DATABASE_URL', 'CLERK_SECRET_KEY', 'CLERK_PUBLISHABLE_KEY', 'CLERK_JWT_KEY', 'CLERK_AUTHORIZED_PARTIES', 'CLERK_WEBHOOK_SIGNING_SECRET', 'WEB_ORIGINS']) vi.stubEnv(key, 'configured');
    vi.stubEnv('CLERK_JWT_KEY', '   ');
    expect(() => validateEnvironment()).toThrow('Falta configurar CLERK_JWT_KEY');
  });
});
