import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import { AuthContext, type AuthContextValue } from '../../infrastructure/auth/auth-context.js';
import { ClerkAuthGuard } from '../../infrastructure/auth/clerk-auth.guard.js';
import { AccountService } from '../../modules/account/account.service.js';
import { DiagramService } from '../../modules/diagrams/diagram.service.js';
import { SharePreviewService } from '../../modules/diagrams/share-preview.service.js';
import { DiagramShareService } from '../../modules/diagrams/diagram-share.service.js';

@Controller('v1') @UseGuards(ClerkAuthGuard)
export class DiagramsController {
  constructor(@Inject(AccountService) private readonly accounts: AccountService, @Inject(DiagramService) private readonly diagrams: DiagramService, @Inject(SharePreviewService) private readonly preview: SharePreviewService, @Inject(DiagramShareService) private readonly shares: DiagramShareService) {}
  private async accountId(auth: AuthContextValue) { return (await this.accounts.ensureLocalUser(auth)).account.id; }
  @Get('projects/:projectId/diagrams') async list(@AuthContext() auth: AuthContextValue, @Param('projectId', new ParseUUIDPipe()) projectId: string, @Query('status') status?: string) { return { data: await this.diagrams.list(await this.accountId(auth), projectId, status === 'archived' ? 'archived' : 'active') }; }
  @Post('projects/:projectId/diagrams') async create(@AuthContext() auth: AuthContextValue, @Param('projectId', new ParseUUIDPipe()) projectId: string, @Body() body: { name?: unknown }) { return { data: await this.diagrams.create(await this.accountId(auth), projectId, body.name) }; }
  @Get('diagrams/:id') async get(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string) { return { data: await this.diagrams.get(await this.accountId(auth), id) }; }
  @Get('diagrams/:id/share-preview') async sharePreview(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string, @Res({ passthrough: true }) response: { header(name: string, value: string): unknown }) { response.header('Cache-Control', 'private, no-store'); return { data: await this.preview.get(await this.accountId(auth), id) }; }
  @Post('diagrams/:id/shares') async publish(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: { fingerprint?: unknown; idempotencyKey?: unknown }, @Res({ passthrough: true }) response: { header(name: string, value: string): unknown }) { const identity = await this.accounts.ensureLocalUser(auth); response.header('Cache-Control', 'private, no-store'); return { data: await this.shares.publish(identity.account.id, identity.user.id, id, body) }; }
  @Get('diagrams/:id/shares/active') async activeShare(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string, @Res({ passthrough: true }) response: { header(name: string, value: string): unknown }) { response.header('Cache-Control', 'private, no-store'); return { data: await this.shares.manage(await this.accountId(auth), id) }; }
  @Patch('diagrams/:id/shares/active/comments') async shareComments(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: { enabled?: unknown }, @Res({ passthrough: true }) response: { header(name: string, value: string): unknown }) { const identity = await this.accounts.ensureLocalUser(auth); response.header('Cache-Control', 'private, no-store'); return { data: await this.shares.setComments(identity.account.id, identity.user.id, id, body) }; }
  @Put('diagrams/:id/shares/active/projection') async refreshShare(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: { fingerprint?: unknown; expectedPublishedFingerprint?: unknown }, @Res({ passthrough: true }) response: { header(name: string, value: string): unknown }) { const identity = await this.accounts.ensureLocalUser(auth); response.header('Cache-Control', 'private, no-store'); return { data: await this.shares.refresh(identity.account.id, identity.user.id, id, body) }; }
  @Post('diagrams/:id/shares/active/revoke') async revokeShare(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: { expectedPublishedFingerprint?: unknown; confirmation?: unknown }, @Res({ passthrough: true }) response: { header(name: string, value: string): unknown }) { const identity = await this.accounts.ensureLocalUser(auth); response.header('Cache-Control', 'private, no-store'); return { data: await this.shares.revoke(identity.account.id, identity.user.id, id, body) }; }
  @Patch('diagrams/:id') async rename(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: { name?: unknown }) {
    const identity = await this.accounts.ensureLocalUser(auth);
    const renamed = await this.diagrams.rename(identity.account.id, id, body.name);
    await this.shares.enqueueSync({ accountId: identity.account.id, actorUserId: identity.user.id, diagramId: id });
    return { data: renamed };
  }
  @Put('diagrams/:id/document') async save(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: { document?: unknown; expectedRevision?: unknown; idempotencyKey?: unknown }) {
    const identity = await this.accounts.ensureLocalUser(auth);
    const saved = await this.diagrams.save(identity.account.id, id, body);
    await this.shares.enqueueSync({ accountId: identity.account.id, actorUserId: identity.user.id, diagramId: id });
    return { data: saved };
  }
  @Post('diagrams/:id/duplicates') async duplicate(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: { name?: unknown }) { return { data: await this.diagrams.duplicate(await this.accountId(auth), id, body.name) }; }
  @Post('diagrams/:id/restore') async restore(@AuthContext() auth: AuthContextValue, @Param('id', new ParseUUIDPipe()) id: string) { return { data: await this.diagrams.restore(await this.accountId(auth), id) }; }
}
