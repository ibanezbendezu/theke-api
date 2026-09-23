import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { AuthContext, type AuthContextValue } from '../../infrastructure/auth/auth-context.js';
import { ClerkAuthGuard } from '../../infrastructure/auth/clerk-auth.guard.js';
import { AccountService } from '../../modules/account/account.service.js';
import { UploadService } from '../../modules/uploads/upload.service.js';

@Controller('v1/uploads')
@UseGuards(ClerkAuthGuard)
export class UploadsController {
  constructor(@Inject(AccountService) private readonly accounts: AccountService, @Inject(UploadService) private readonly service: UploadService) {}
  private identity(auth: AuthContextValue) { return this.accounts.ensureLocalUser(auth); }
  @Get('policy') policy() { return { data: this.service.policy() }; }
  @Get() async list(@AuthContext() auth: AuthContextValue) { const identity = await this.identity(auth); return { data: await this.service.list(identity.account.id) }; }
  @Post() async create(@AuthContext() auth: AuthContextValue, @Body() body: { name?: unknown; size?: unknown; mediaType?: unknown; idempotencyKey?: unknown }) { const identity = await this.identity(auth); return { data: await this.service.create(identity.account.id, identity.user.id, body) }; }
  @Get(':id') async get(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string) { const identity = await this.identity(auth); return { data: await this.service.get(identity.account.id, id) }; }
  @Post(':id/finalize') async finalize(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string, @Req() request: { id: string }) { const identity = await this.identity(auth); return { data: await this.service.finalize(identity.account.id, id, request.id) }; }
  @Post(':id/cancel') async cancel(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string) { const identity = await this.identity(auth); return { data: await this.service.cancel(identity.account.id, id) }; }
}
