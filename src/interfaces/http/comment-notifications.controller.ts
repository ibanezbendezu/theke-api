import { Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Patch, Query, Res, Sse, UseGuards, type MessageEvent } from '@nestjs/common';
import { from, timer, distinctUntilChanged, map, switchMap, type Observable } from 'rxjs';
import { AuthContext, type AuthContextValue } from '../../infrastructure/auth/auth-context.js';
import { ClerkAuthGuard } from '../../infrastructure/auth/clerk-auth.guard.js';
import { AccountService } from '../../modules/account/account.service.js';
import { CommentNotificationsService } from '../../modules/diagrams/comment-notifications.service.js';

@Controller('v1/comment-notifications')
@UseGuards(ClerkAuthGuard)
export class CommentNotificationsController {
  constructor(@Inject(AccountService) private readonly accounts: AccountService,
    @Inject(CommentNotificationsService) private readonly notifications: CommentNotificationsService) {}

  @Get() async list(@AuthContext() auth: AuthContextValue, @Query('diagramId') diagramId?: string, @Query('commentId') commentId?: string,
    @Query('page') page?: string, @Query('filter') filter?: string,
    @Res({ passthrough: true }) response?: { header(name: string, value: string): unknown }) {
    response?.header('Cache-Control', 'private, no-store');
    const identity = await this.accounts.ensureLocalUser(auth);
    return { data: await this.notifications.list(identity.account.id, { diagramId, commentId, page, filter }) };
  }

  @Sse('events') events(@AuthContext() auth: AuthContextValue): Observable<MessageEvent> {
    return from(this.accounts.ensureLocalUser(auth)).pipe(
      switchMap(identity => timer(0, 10_000).pipe(switchMap(() => from(this.notifications.signal(identity.account.id))))),
      distinctUntilChanged((a, b) => a.latestId === b.latestId && a.moderationId === b.moderationId && a.unreadCount === b.unreadCount),
      map(data => ({ type: 'comments', data }))
    );
  }

  @Patch(':id/read') async read(@AuthContext() auth: AuthContextValue,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) response: { header(name: string, value: string): unknown }) {
    response.header('Cache-Control', 'private, no-store');
    const identity = await this.accounts.ensureLocalUser(auth);
    return { data: await this.notifications.markRead(identity.account.id, id) };
  }

  @Patch(':id/resolve') async resolve(@AuthContext() auth: AuthContextValue,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) response: { header(name: string, value: string): unknown }) {
    response.header('Cache-Control', 'private, no-store');
    const identity = await this.accounts.ensureLocalUser(auth);
    return { data: await this.notifications.moderate(identity.account.id, identity.user.id, id, 'resolve') };
  }

  @Patch(':id/reopen') async reopen(@AuthContext() auth: AuthContextValue,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) response: { header(name: string, value: string): unknown }) {
    response.header('Cache-Control', 'private, no-store');
    const identity = await this.accounts.ensureLocalUser(auth);
    return { data: await this.notifications.moderate(identity.account.id, identity.user.id, id, 'reopen') };
  }

  @Delete(':id') async delete(@AuthContext() auth: AuthContextValue,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) response: { header(name: string, value: string): unknown }) {
    response.header('Cache-Control', 'private, no-store');
    const identity = await this.accounts.ensureLocalUser(auth);
    return { data: await this.notifications.moderate(identity.account.id, identity.user.id, id, 'delete') };
  }
}
