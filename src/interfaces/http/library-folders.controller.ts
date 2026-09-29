import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AccountService } from '../../modules/account/account.service.js';
import { LibraryFolderService } from '../../modules/resources/library-folder.service.js';
import { AuthContext, type AuthContextValue } from '../../infrastructure/auth/auth-context.js';
import { ClerkAuthGuard } from '../../infrastructure/auth/clerk-auth.guard.js';

@Controller('v1/library-folders') @UseGuards(ClerkAuthGuard)
export class LibraryFoldersController {
  constructor(@Inject(AccountService) private readonly accounts: AccountService, @Inject(LibraryFolderService) private readonly folders: LibraryFolderService) {}
  private async accountId(auth: AuthContextValue) { return (await this.accounts.ensureLocalUser(auth)).account.id; }
  @Get() async list(@AuthContext() auth: AuthContextValue) { return { data: await this.folders.list(await this.accountId(auth)) }; }
  @Post() async create(@AuthContext() auth: AuthContextValue, @Body() body: { name?: unknown; parentFolderId?: string | null }) { return { data: await this.folders.create(await this.accountId(auth), body.name, body.parentFolderId ?? null) }; }
  @Patch('resources') async move(@AuthContext() auth: AuthContextValue, @Body() body: { resourceIds?: string[]; folderId?: string | null }) { return { data: await this.folders.move(await this.accountId(auth), body.resourceIds ?? [], body.folderId ?? null) }; }
  @Patch(':id/parent') async moveFolder(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: { parentFolderId?: string | null }) { return { data: await this.folders.moveFolder(await this.accountId(auth), id, body.parentFolderId ?? null) }; }
  @Patch(':id') async rename(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: { name?: unknown }) { return { data: await this.folders.rename(await this.accountId(auth), id, body.name) }; }
  @Delete(':id') async remove(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string) { return { data: await this.folders.remove(await this.accountId(auth), id) }; }
}
