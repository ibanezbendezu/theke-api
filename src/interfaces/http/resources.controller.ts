import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthContext, type AuthContextValue } from '../../infrastructure/auth/auth-context.js';
import { ClerkAuthGuard } from '../../infrastructure/auth/clerk-auth.guard.js';
import { AccountService } from '../../modules/account/account.service.js';
import { ResourceService } from '../../modules/resources/resource.service.js';
import { ResourceKnowledgeService } from '../../modules/resources/resource-knowledge.service.js';
import { DiagramShareService } from '../../modules/diagrams/diagram-share.service.js';

@Controller('v1/resources') @UseGuards(ClerkAuthGuard)
export class ResourcesController {
  constructor(@Inject(AccountService) private readonly accounts: AccountService, @Inject(ResourceService) private readonly resources: ResourceService, @Inject(ResourceKnowledgeService) private readonly knowledge: ResourceKnowledgeService, @Inject(DiagramShareService) private readonly shares: DiagramShareService) {}
  private async accountId(auth: AuthContextValue) { return (await this.accounts.ensureLocalUser(auth)).account.id; }
  @Get() list(@AuthContext() auth: AuthContextValue, @Query('type') type?: string, @Query('status') status?: string, @Query('cursor') cursor?: string, @Query('q') query?: string, @Query('projectId') projectId?: string, @Query('folderId') folderId?: string, @Query('tag') tag?: string, @Query('libraryFolderId') libraryFolderId?: string) { return this.accountId(auth).then(accountId => this.resources.list(accountId, { type, status, cursor, query, projectId, folderId, tag, libraryFolderId })); }
  @Get('property-definitions') async definitions(@AuthContext() auth: AuthContextValue) { return { data: await this.knowledge.definitions(await this.accountId(auth)) }; }
  @Get(':id') async get(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string) { return { data: await this.resources.get(await this.accountId(auth), id) }; }
  @Patch(':id') async renameFile(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: { title?: unknown; expectedUpdatedAt?: unknown }) {
    const identity = await this.accounts.ensureLocalUser(auth);
    const file = await this.resources.renameFile(identity.account.id, id, body?.title, body?.expectedUpdatedAt);
    await this.shares.enqueueSync({ accountId: identity.account.id, actorUserId: identity.user.id, resourceId: id });
    return { data: file };
  }
  @Get(':id/references') async references(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string) { return { data: await this.knowledge.references(await this.accountId(auth), id) }; }
  @Patch(':id/metadata') async metadata(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: Parameters<ResourceKnowledgeService['updateMetadata']>[2]) {
    const identity = await this.accounts.ensureLocalUser(auth);
    const metadata = await this.knowledge.updateMetadata(identity.account.id, id, body);
    await this.shares.enqueueSync({ accountId: identity.account.id, actorUserId: identity.user.id, resourceId: id });
    return { data: metadata };
  }
  @Get(':id/access') async access(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string, @Query('mode') mode?: string) { return { data: await this.resources.access(await this.accountId(auth), id, mode) }; }
  @Patch(':id/accessibility') async accessibility(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: { text?: unknown }) {
    const identity = await this.accounts.ensureLocalUser(auth);
    const accessibility = await this.resources.setAccessibility(identity.account.id, id, body.text);
    await this.shares.enqueueSync({ accountId: identity.account.id, actorUserId: identity.user.id, resourceId: id });
    return { data: accessibility };
  }
  @Post(':id/restore') async restore(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string) {
    const identity = await this.accounts.ensureLocalUser(auth);
    const resource = await this.resources.restore(identity.account.id, id);
    await this.shares.enqueueSync({ accountId: identity.account.id, actorUserId: identity.user.id, resourceId: id });
    return { data: resource };
  }
}
