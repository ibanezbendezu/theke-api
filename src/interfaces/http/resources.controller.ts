import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthContext, type AuthContextValue } from '../../infrastructure/auth/auth-context.js';
import { ClerkAuthGuard } from '../../infrastructure/auth/clerk-auth.guard.js';
import { AccountService } from '../../modules/account/account.service.js';
import { ResourceService } from '../../modules/resources/resource.service.js';
import { ResourceKnowledgeService } from '../../modules/resources/resource-knowledge.service.js';

@Controller('v1/resources') @UseGuards(ClerkAuthGuard)
export class ResourcesController {
  constructor(@Inject(AccountService) private readonly accounts: AccountService, @Inject(ResourceService) private readonly resources: ResourceService, @Inject(ResourceKnowledgeService) private readonly knowledge: ResourceKnowledgeService) {}
  private async accountId(auth: AuthContextValue) { return (await this.accounts.ensureLocalUser(auth)).account.id; }
  @Get() list(@AuthContext() auth: AuthContextValue, @Query('type') type?: string, @Query('status') status?: string, @Query('cursor') cursor?: string, @Query('q') query?: string, @Query('projectId') projectId?: string, @Query('folderId') folderId?: string, @Query('tag') tag?: string) { return this.accountId(auth).then(accountId => this.resources.list(accountId, { type, status, cursor, query, projectId, folderId, tag })); }
  @Get('property-definitions') async definitions(@AuthContext() auth: AuthContextValue) { return { data: await this.knowledge.definitions(await this.accountId(auth)) }; }
  @Get(':id') async get(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string) { return { data: await this.resources.get(await this.accountId(auth), id) }; }
  @Get(':id/references') async references(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string) { return { data: await this.knowledge.references(await this.accountId(auth), id) }; }
  @Patch(':id/metadata') async metadata(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: Parameters<ResourceKnowledgeService['updateMetadata']>[2]) { return { data: await this.knowledge.updateMetadata(await this.accountId(auth), id, body) }; }
  @Get(':id/access') async access(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string, @Query('mode') mode?: string) { return { data: await this.resources.access(await this.accountId(auth), id, mode) }; }
  @Patch(':id/accessibility') async accessibility(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: { text?: unknown }) { return { data: await this.resources.setAccessibility(await this.accountId(auth), id, body.text) }; }
  @Post(':id/restore') async restore(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string) { return { data: await this.resources.restore(await this.accountId(auth), id) }; }
}
