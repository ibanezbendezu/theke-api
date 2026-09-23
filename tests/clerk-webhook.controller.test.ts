import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyWebhook } from '@clerk/backend/webhooks';
import { ClerkWebhookController } from '../src/interfaces/http/clerk-webhook.controller.js';

vi.mock('@clerk/backend/webhooks', () => ({ verifyWebhook: vi.fn() }));
const mockedVerifyWebhook = vi.mocked(verifyWebhook);
const request = { rawBody: Buffer.from('{}'), url: '/v1/webhooks/clerk', protocol: 'https', hostname: 'api.test' } as any;

afterEach(() => vi.clearAllMocks());

describe('webhook Clerk', () => {
  it.each(['user.created', 'user.updated'] as const)('mapea %s verificado a ensureLocalUser', async (type) => {
    mockedVerifyWebhook.mockResolvedValue({
      type,
      data: { id: 'clerk_user_1', primary_email_address_id: 'email_1', email_addresses: [{ id: 'email_1', email_address: 'daniel@example.test' }], first_name: 'Daniel', last_name: 'Rojas' },
    } as any);
    const ensureLocalUser = vi.fn(async () => undefined);
    const response = await new ClerkWebhookController({ ensureLocalUser } as any).clerk(request, { 'svix-id': 'msg_1' });
    expect(ensureLocalUser).toHaveBeenCalledWith({ clerkUserId: 'clerk_user_1', email: 'daniel@example.test', displayName: 'Daniel Rojas' });
    expect(response).toEqual({ data: { accepted: true } });
  });

  it('rechaza una firma inválida sin aprovisionar', async () => {
    mockedVerifyWebhook.mockRejectedValue(new Error('Invalid signature'));
    const ensureLocalUser = vi.fn();
    await expect(new ClerkWebhookController({ ensureLocalUser } as any).clerk(request, {})).rejects.toThrow('Invalid signature');
    expect(ensureLocalUser).not.toHaveBeenCalled();
  });
});
