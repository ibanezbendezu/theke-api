import { Body, Controller, Inject, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthContext, type AuthContextValue } from '../../infrastructure/auth/auth-context.js';
import { ClerkAuthGuard } from '../../infrastructure/auth/clerk-auth.guard.js';
import { AccountService } from '../../modules/account/account.service.js';
import { LinkService, type LinkInput } from '../../modules/resources/link.service.js';

@Controller('v1/links') @UseGuards(ClerkAuthGuard)
export class LinksController {
  constructor(@Inject(AccountService) private readonly accounts: AccountService, @Inject(LinkService) private readonly links: LinkService) {}
  private identity(auth: AuthContextValue) { return this.accounts.ensureLocalUser(auth); }
  @Post() async create(@AuthContext() auth: AuthContextValue, @Body() body: LinkInput) { const identity = await this.identity(auth); return { data: await this.links.create(identity.account.id, identity.user.id, body) }; }
  @Patch(':id') async update(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: LinkInput) { return { data: await this.links.update((await this.identity(auth)).account.id, id, body) }; }
  @Post(':id/metadata-retries') async retry(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string) { return { data: await this.links.retry((await this.identity(auth)).account.id, id) }; }
}
