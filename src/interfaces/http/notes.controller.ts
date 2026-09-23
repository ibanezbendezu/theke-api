import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthContext, type AuthContextValue } from '../../infrastructure/auth/auth-context.js';
import { ClerkAuthGuard } from '../../infrastructure/auth/clerk-auth.guard.js';
import { AccountService } from '../../modules/account/account.service.js';
import { NoteService, type NoteInput } from '../../modules/resources/note.service.js';

@Controller('v1/notes')
@UseGuards(ClerkAuthGuard)
export class NotesController {
  constructor(@Inject(AccountService) private readonly accounts: AccountService, @Inject(NoteService) private readonly notes: NoteService) {}
  private identity(auth: AuthContextValue) { return this.accounts.ensureLocalUser(auth); }
  @Get() async list(@AuthContext() auth: AuthContextValue, @Query('cursor') cursor?: string) { const identity = await this.identity(auth); return this.notes.list(identity.account.id, cursor); }
  @Post() async create(@AuthContext() auth: AuthContextValue, @Body() body: NoteInput) { const identity = await this.identity(auth); return { data: await this.notes.create(identity.account.id, identity.user.id, body) }; }
  @Get(':id') async get(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string) { const identity = await this.identity(auth); return { data: await this.notes.get(identity.account.id, id) }; }
  @Patch(':id') async update(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: NoteInput) { const identity = await this.identity(auth); return { data: await this.notes.update(identity.account.id, identity.user.id, id, body) }; }
}
