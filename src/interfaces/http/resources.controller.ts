import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { AuthContext, type AuthContextValue } from '../../infrastructure/auth/auth-context.js';
import { ClerkAuthGuard } from '../../infrastructure/auth/clerk-auth.guard.js';
import { AccountService } from '../../modules/account/account.service.js';
import { ResourceService } from '../../modules/resources/resource.service.js';

@Controller('v1/resources') @UseGuards(ClerkAuthGuard)
export class ResourcesController {
  constructor(@Inject(AccountService) private readonly accounts: AccountService, @Inject(ResourceService) private readonly resources: ResourceService) {}
  private async accountId(auth: AuthContextValue) { return (await this.accounts.ensureLocalUser(auth)).account.id; }
  @Get() list(@AuthContext() auth: AuthContextValue, @Query('type') type?: string, @Query('cursor') cursor?: string, @Query('q') query?: string, @Query('projectId') projectId?: string, @Query('folderId') folderId?: string) { return this.accountId(auth).then(accountId => this.resources.list(accountId, { type, cursor, query, projectId, folderId })); }
  @Get(':id') async get(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string) { return { data: await this.resources.get(await this.accountId(auth), id) }; }
  @Get(':id/access') async access(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string, @Query('mode') mode?: string) { return { data: await this.resources.access(await this.accountId(auth), id, mode) }; }
  @Patch(':id/accessibility') async accessibility(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: { text?: unknown }) { return { data: await this.resources.setAccessibility(await this.accountId(auth), id, body.text) }; }
}
