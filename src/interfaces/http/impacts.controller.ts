import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AuthContext, type AuthContextValue } from '../../infrastructure/auth/auth-context.js';
import { ClerkAuthGuard } from '../../infrastructure/auth/clerk-auth.guard.js';
import { AccountService } from '../../modules/account/account.service.js';
import { ImpactService, type ImpactAction, type ImpactEntityType } from '../../modules/lifecycle/impact.service.js';

@Controller('v1/impacts') @UseGuards(ClerkAuthGuard)
export class ImpactsController {
  constructor(@Inject(AccountService) private readonly accounts: AccountService, @Inject(ImpactService) private readonly impacts: ImpactService) {}
  private async accountId(auth: AuthContextValue) { return (await this.accounts.ensureLocalUser(auth)).account.id; }
  @Get(':entityType/:id') async get(@AuthContext() auth: AuthContextValue, @Param('entityType') entityType: ImpactEntityType, @Param('id', new ParseUUIDPipe()) id: string, @Query('action') action: ImpactAction) { return { data: await this.impacts.get(await this.accountId(auth), entityType, id, action) }; }
  @Post(':entityType/:id') async execute(@AuthContext() auth: AuthContextValue, @Param('entityType') entityType: ImpactEntityType, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: { action?: unknown; impactVersion?: unknown; confirmation?: unknown; idempotencyKey?: unknown }) { return { data: await this.impacts.execute(await this.accountId(auth), entityType, id, body) }; }
}
