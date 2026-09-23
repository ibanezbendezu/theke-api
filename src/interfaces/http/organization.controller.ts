import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthContext, type AuthContextValue } from '../../infrastructure/auth/auth-context.js';
import { ClerkAuthGuard } from '../../infrastructure/auth/clerk-auth.guard.js';
import { AccountService } from '../../modules/account/account.service.js';
import { OrganizationService } from '../../modules/projects/organization.service.js';

@Controller('v1/projects/:projectId') @UseGuards(ClerkAuthGuard)
export class OrganizationController {
  constructor(@Inject(AccountService) private readonly accounts: AccountService, @Inject(OrganizationService) private readonly organization: OrganizationService) {}
  private async accountId(auth: AuthContextValue) { return (await this.accounts.ensureLocalUser(auth)).account.id; }
  @Get('organization') async list(@AuthContext() auth: AuthContextValue, @Param('projectId', new ParseUUIDPipe()) projectId: string) { return { data: await this.organization.list(await this.accountId(auth), projectId) }; }
  @Post('folders') async createFolder(@AuthContext() auth: AuthContextValue, @Param('projectId', new ParseUUIDPipe()) projectId: string, @Body() body: { name?: unknown; parentFolderId?: string | null }) { return { data: await this.organization.createFolder(await this.accountId(auth), projectId, body.name, body.parentFolderId) }; }
  @Patch('folders/:id') async updateFolder(@AuthContext() auth: AuthContextValue, @Param('projectId', new ParseUUIDPipe()) projectId: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: { name?: unknown; parentFolderId?: string | null }) { return { data: await this.organization.updateFolder(await this.accountId(auth), projectId, id, body) }; }
  @Post('folders/:id/archive') async archive(@AuthContext() auth: AuthContextValue, @Param('projectId', new ParseUUIDPipe()) projectId: string, @Param('id', new ParseUUIDPipe()) id: string) { return { data: await this.organization.archiveFolder(await this.accountId(auth), projectId, id, true) }; }
  @Post('folders/:id/restore') async restore(@AuthContext() auth: AuthContextValue, @Param('projectId', new ParseUUIDPipe()) projectId: string, @Param('id', new ParseUUIDPipe()) id: string) { return { data: await this.organization.archiveFolder(await this.accountId(auth), projectId, id, false) }; }
  @Post('resources') async add(@AuthContext() auth: AuthContextValue, @Param('projectId', new ParseUUIDPipe()) projectId: string, @Body() body: { resourceIds?: string[]; folderId?: string | null }) { return { data: await this.organization.addResources(await this.accountId(auth), projectId, body.resourceIds ?? [], body.folderId) }; }
  @Patch('resources') async move(@AuthContext() auth: AuthContextValue, @Param('projectId', new ParseUUIDPipe()) projectId: string, @Body() body: { resourceIds?: string[]; folderId?: string | null }) { return { data: await this.organization.moveResources(await this.accountId(auth), projectId, body.resourceIds ?? [], body.folderId) }; }
}
