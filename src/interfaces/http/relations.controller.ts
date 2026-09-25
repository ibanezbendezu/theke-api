import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthContext, type AuthContextValue } from '../../infrastructure/auth/auth-context.js';
import { ClerkAuthGuard } from '../../infrastructure/auth/clerk-auth.guard.js';
import { AccountService } from '../../modules/account/account.service.js';
import { RelationService } from '../../modules/relations/relation.service.js';

@Controller('v1') @UseGuards(ClerkAuthGuard)
export class RelationsController {
  constructor(@Inject(AccountService) private readonly accounts: AccountService, @Inject(RelationService) private readonly relations: RelationService) {}
  private async accountId(auth: AuthContextValue) { return (await this.accounts.ensureLocalUser(auth)).account.id; }
  @Get('projects/:projectId/relation-types') async types(@AuthContext() auth: AuthContextValue, @Param('projectId', new ParseUUIDPipe()) projectId: string) { return { data: await this.relations.types(await this.accountId(auth), projectId) }; }
  @Post('diagrams/:id/relations') async create(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: Parameters<RelationService['create']>[3]) { const identity = await this.accounts.ensureLocalUser(auth); return { data: await this.relations.create(identity.account.id, identity.user.id, id, body) }; }
  @Get('diagrams/:id/available-relations') async available(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string) { return { data: await this.relations.available(await this.accountId(auth), id) }; }
  @Get('relations/:id') async get(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string) { return { data: await this.relations.get(await this.accountId(auth), id) }; }
  @Patch('relations/:id') async update(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: Parameters<RelationService['update']>[3]) { const identity = await this.accounts.ensureLocalUser(auth); return { data: await this.relations.update(identity.account.id, identity.user.id, id, body) }; }
  @Post('relations/:id/restore') async restore(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string) { return { data: await this.relations.restore(await this.accountId(auth), id) }; }
}
