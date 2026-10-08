import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthContext, type AuthContextValue } from '../../infrastructure/auth/auth-context.js';
import { ClerkAuthGuard } from '../../infrastructure/auth/clerk-auth.guard.js';
import { AccountService } from '../../modules/account/account.service.js';
import { RelationService } from '../../modules/relations/relation.service.js';
import { DiagramShareService } from '../../modules/diagrams/diagram-share.service.js';

@Controller('v1') @UseGuards(ClerkAuthGuard)
export class RelationsController {
  constructor(@Inject(AccountService) private readonly accounts: AccountService, @Inject(RelationService) private readonly relations: RelationService, @Inject(DiagramShareService) private readonly shares: DiagramShareService) {}
  private async accountId(auth: AuthContextValue) { return (await this.accounts.ensureLocalUser(auth)).account.id; }
  @Get('projects/:projectId/relation-types') async types(@AuthContext() auth: AuthContextValue, @Param('projectId', new ParseUUIDPipe()) projectId: string) { return { data: await this.relations.types(await this.accountId(auth), projectId) }; }
  @Post('diagrams/:id/relations') async create(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: Parameters<RelationService['create']>[3]) {
    const identity = await this.accounts.ensureLocalUser(auth);
    const created = await this.relations.create(identity.account.id, identity.user.id, id, body);
    await this.shares.enqueueSync({ accountId: identity.account.id, actorUserId: identity.user.id, diagramId: id });
    return { data: created };
  }
  @Get('diagrams/:id/available-relations') async available(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string) { return { data: await this.relations.available(await this.accountId(auth), id) }; }
  @Get('relations/:id') async get(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string) { return { data: await this.relations.get(await this.accountId(auth), id) }; }
  @Patch('relations/:id') async update(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: Parameters<RelationService['update']>[3]) {
    const identity = await this.accounts.ensureLocalUser(auth);
    const updated = await this.relations.update(identity.account.id, identity.user.id, id, body);
    if (updated.diagramId) await this.shares.enqueueSync({ accountId: identity.account.id, actorUserId: identity.user.id, diagramId: updated.diagramId });
    return { data: updated };
  }
  @Post('relations/:id/restore') async restore(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string) {
    const identity = await this.accounts.ensureLocalUser(auth);
    const restored = await this.relations.restore(identity.account.id, id);
    if (restored.diagramId) await this.shares.enqueueSync({ accountId: identity.account.id, actorUserId: identity.user.id, diagramId: restored.diagramId });
    return { data: restored };
  }
}
