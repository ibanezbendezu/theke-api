import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthContext, type AuthContextValue } from '../../infrastructure/auth/auth-context.js';
import { ClerkAuthGuard } from '../../infrastructure/auth/clerk-auth.guard.js';
import { AccountService } from '../../modules/account/account.service.js';
import { DiagramService } from '../../modules/diagrams/diagram.service.js';

@Controller('v1') @UseGuards(ClerkAuthGuard)
export class DiagramsController {
  constructor(@Inject(AccountService) private readonly accounts: AccountService, @Inject(DiagramService) private readonly diagrams: DiagramService) {}
  private async accountId(auth: AuthContextValue) { return (await this.accounts.ensureLocalUser(auth)).account.id; }
  @Get('projects/:projectId/diagrams') async list(@AuthContext() auth: AuthContextValue, @Param('projectId', new ParseUUIDPipe()) projectId: string, @Query('status') status?: string) { return { data: await this.diagrams.list(await this.accountId(auth), projectId, status === 'archived' ? 'archived' : 'active') }; }
  @Post('projects/:projectId/diagrams') async create(@AuthContext() auth: AuthContextValue, @Param('projectId', new ParseUUIDPipe()) projectId: string, @Body() body: { name?: unknown }) { return { data: await this.diagrams.create(await this.accountId(auth), projectId, body.name) }; }
  @Get('diagrams/:id') async get(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string) { return { data: await this.diagrams.get(await this.accountId(auth), id) }; }
  @Patch('diagrams/:id') async rename(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: { name?: unknown }) { return { data: await this.diagrams.rename(await this.accountId(auth), id, body.name) }; }
  @Post('diagrams/:id/duplicates') async duplicate(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: { name?: unknown }) { return { data: await this.diagrams.duplicate(await this.accountId(auth), id, body.name) }; }
  @Post('diagrams/:id/restore') async restore(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string) { return { data: await this.diagrams.restore(await this.accountId(auth), id) }; }
}
