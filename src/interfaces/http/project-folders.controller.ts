import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AccountService } from '../../modules/account/account.service.js';
import { ProjectFolderService } from '../../modules/projects/project-folder.service.js';
import { AuthContext, type AuthContextValue } from '../../infrastructure/auth/auth-context.js';
import { ClerkAuthGuard } from '../../infrastructure/auth/clerk-auth.guard.js';

@Controller('v1/project-folders') @UseGuards(ClerkAuthGuard)
export class ProjectFoldersController {
  constructor(@Inject(AccountService) private readonly accounts: AccountService, @Inject(ProjectFolderService) private readonly folders: ProjectFolderService) {}
  private async accountId(auth: AuthContextValue) { return (await this.accounts.ensureLocalUser(auth)).account.id; }
  @Get() async list(@AuthContext() auth: AuthContextValue) { return { data: await this.folders.list(await this.accountId(auth)) }; }
  @Post() async create(@AuthContext() auth: AuthContextValue, @Body() body: { name?: unknown }) { return { data: await this.folders.create(await this.accountId(auth), body.name) }; }
  @Patch('projects') async move(@AuthContext() auth: AuthContextValue, @Body() body: { projectIds?: string[]; folderId?: string | null }) { return { data: await this.folders.move(await this.accountId(auth), body.projectIds ?? [], body.folderId ?? null) }; }
  @Patch(':id') async rename(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: { name?: unknown }) { return { data: await this.folders.rename(await this.accountId(auth), id, body.name) }; }
  @Delete(':id') async remove(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string) { return { data: await this.folders.remove(await this.accountId(auth), id) }; }
}
