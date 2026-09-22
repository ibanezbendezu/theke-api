import { BadRequestException, Controller, Headers, Post, RawBodyRequest, Req } from '@nestjs/common';
import { verifyWebhook } from '@clerk/backend/webhooks';
import type { FastifyRequest } from 'fastify';
import { AccountService } from '../../modules/account/account.service.js';

@Controller('v1/webhooks')
export class ClerkWebhookController {
  constructor(private readonly accounts: AccountService) {}
  @Post('clerk')
  async clerk(@Req() request: RawBodyRequest<FastifyRequest>, @Headers() headers: Record<string, string>) {
    if (!request.rawBody) throw new BadRequestException('Webhook sin cuerpo verificable');
    const url = new URL(request.url, `${request.protocol}://${request.hostname}`);
    const event = await verifyWebhook(new Request(url, { method: 'POST', headers, body: new Uint8Array(request.rawBody) }), { signingSecret: process.env.CLERK_WEBHOOK_SIGNING_SECRET });
    if (event.type === 'user.created' || event.type === 'user.updated') {
      const primaryEmail = event.data.email_addresses.find((item) => item.id === event.data.primary_email_address_id)?.email_address ?? null;
      const displayName = [event.data.first_name, event.data.last_name].filter(Boolean).join(' ') || null;
      await this.accounts.ensureLocalUser({ clerkUserId: event.data.id, email: primaryEmail, displayName });
    }
    return { data: { accepted: true } };
  }
}
