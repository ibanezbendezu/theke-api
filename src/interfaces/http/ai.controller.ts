import { Body, Controller, Get, Inject, Post, UseGuards } from '@nestjs/common';
import { AuthContext, type AuthContextValue } from '../../infrastructure/auth/auth-context.js';
import { ClerkAuthGuard } from '../../infrastructure/auth/clerk-auth.guard.js';
import { AccountService } from '../../modules/account/account.service.js';
import { AiService } from '../../modules/ai/ai.service.js';
import type { AiConsentInput, AiPreflightInput, AiSettingsInput } from '../../modules/ai/ai.types.js';

@Controller('v1/ai')
@UseGuards(ClerkAuthGuard)
export class AiController {
  constructor(
    @Inject(AccountService) private readonly accounts: AccountService,
    @Inject(AiService) private readonly ai: AiService,
  ) {}

  private async accountId(auth: AuthContextValue) {
    return (await this.accounts.ensureLocalUser(auth)).account.id;
  }

  @Get('status')
  async status(@AuthContext() auth: AuthContextValue) {
    return { data: await this.ai.getStatus(await this.accountId(auth)) };
  }

  @Post('consent')
  async consent(@AuthContext() auth: AuthContextValue, @Body() body: AiConsentInput) {
    const identity = await this.accounts.ensureLocalUser(auth);
    return { data: await this.ai.updateConsent(identity.account.id, identity.user.id, body) };
  }

  @Post('revoke-consent')
  async revokeConsent(@AuthContext() auth: AuthContextValue) {
    const accountId = await this.accountId(auth);
    return { data: await this.ai.revokeConsent(accountId) };
  }

  @Post('settings')
  async settings(@AuthContext() auth: AuthContextValue, @Body() body: AiSettingsInput) {
    const accountId = await this.accountId(auth);
    return { data: await this.ai.updateSettings(accountId, body) };
  }

  @Post('preflight-check')
  async preflightCheck(@AuthContext() auth: AuthContextValue, @Body() body: AiPreflightInput) {
    const identity = await this.accounts.ensureLocalUser(auth);
    return { data: await this.ai.preflightCheck(identity.account.id, identity.user.id, body) };
  }
}
