import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthContext, type AuthContextValue } from '../../infrastructure/auth/auth-context.js';
import { ClerkAuthGuard } from '../../infrastructure/auth/clerk-auth.guard.js';
import { AccountService } from '../../modules/account/account.service.js';
import { ProjectService } from '../../modules/projects/project.service.js';
import { DiagramService } from '../../modules/diagrams/diagram.service.js';
import { DiagramShareService } from '../../modules/diagrams/diagram-share.service.js';

@Controller('v1/projects')
@UseGuards(ClerkAuthGuard)
export class ProjectsController {
  constructor(
    @Inject(AccountService) private readonly accounts: AccountService,
    @Inject(ProjectService) private readonly projects: ProjectService,
    @Inject(DiagramService) private readonly diagrams: DiagramService,
    @Inject(DiagramShareService) private readonly shares: DiagramShareService,
  ) {}

  private async accountId(auth: AuthContextValue) { return (await this.accounts.ensureLocalUser(auth)).account.id; }

  @Get()
  async list(@AuthContext() auth: AuthContextValue, @Query('status') status?: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string, @Query('collectionFolderId') collectionFolderId?: string) {
    return this.projects.list(await this.accountId(auth), status === 'archived' ? 'archived' : 'active', cursor, limit ? Number(limit) : undefined, collectionFolderId);
  }

  @Post()
  async create(@AuthContext() auth: AuthContextValue, @Body() body: { name?: unknown; collectionFolderId?: string }) {
    return { data: await this.projects.create(await this.accountId(auth), body?.name, body?.collectionFolderId) };
  }

  @Get(':id')
  async get(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string) {
    return { data: await this.projects.get(await this.accountId(auth), id) };
  }

  @Patch(':id')
  async rename(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: { name?: unknown }) {
    const identity = await this.accounts.ensureLocalUser(auth);
    const renamed = await this.projects.rename(identity.account.id, id, body?.name);
    for (const diagram of await this.diagrams.list(identity.account.id, id, 'active'))
    await this.shares.enqueueSync({ accountId: identity.account.id, actorUserId: identity.user.id, diagramId: diagram.id });
    return { data: renamed };
  }

  @Post(':id/archive')
  async archive(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string) {
    return { data: await this.projects.setArchived(await this.accountId(auth), id, true) };
  }

  @Post(':id/restore')
  async restore(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string) {
    return { data: await this.projects.setArchived(await this.accountId(auth), id, false) };
  }
}
