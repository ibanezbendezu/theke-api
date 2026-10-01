import { Body, Controller, ForbiddenException, Get, HttpCode, Inject, Param, Patch, Post, Query, Req, Res, StreamableFile, UnsupportedMediaTypeException, UseGuards } from '@nestjs/common';
import { Readable } from 'node:stream';
import type { FastifyRequest } from 'fastify';
import { parseEnvironmentList } from '../../config/environment.js';
import { DiagramShareService } from '../../modules/diagrams/diagram-share.service.js';
import { PublicCommentsService } from '../../modules/diagrams/public-comments.service.js';
import { publicCommentRatePolicy } from '../../modules/diagrams/public-comment-rate-policy.js';
import { ClerkAuthGuard } from '../../infrastructure/auth/clerk-auth.guard.js';
import { OptionalClerkAuthGuard } from '../../infrastructure/auth/optional-clerk-auth.guard.js';
import { AuthContext, type AuthContextValue } from '../../infrastructure/auth/auth-context.js';
import { AccountService } from '../../modules/account/account.service.js';

@Controller('v1/public/shares')
export class PublicSharesController {
  constructor(@Inject(DiagramShareService) private readonly shares: DiagramShareService, @Inject(PublicCommentsService) private readonly comments: PublicCommentsService,
    @Inject(AccountService) private readonly accounts: AccountService) {}
  private async commentUser(auth?: AuthContextValue) {
    if (!auth) return undefined;
    const identity = await this.accounts.ensureLocalUser(auth);
    const displayName = identity.user.displayName?.normalize('NFC').trim().replace(/\s+/g, ' ').slice(0, 60);
    return { id: identity.user.id, displayName: displayName && !/\p{C}/u.test(displayName) ? displayName : `Usuario Theke ${identity.user.id.slice(0, 8)}` };
  }
  private requireCommentMutation(request: FastifyRequest) {
    const origin = request.headers.origin;
    if (!origin || !parseEnvironmentList('WEB_ORIGINS').includes(origin)) throw new ForbiddenException('Origen de comentario no permitido.');
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new UnsupportedMediaTypeException('El comentario debe enviarse como JSON.');
  }
  private markRateLimit(error: unknown, request: FastifyRequest, response: { header(name: string, value: string): unknown }) {
    if (error instanceof Error && 'getStatus' in error && typeof error.getStatus === 'function' && error.getStatus() === 429) {
      response.header('Retry-After', '60');
      request.log.warn({ event: 'public_comment_rate_limited', policyVersion: publicCommentRatePolicy.version }, 'Public comment rate limited');
    }
  }
  @Get(':token/comments') @UseGuards(OptionalClerkAuthGuard) async listComments(@Param('token') token: string, @Req() request: FastifyRequest, @AuthContext() auth: AuthContextValue | undefined, @Res({ passthrough: true }) response: { header(name: string, value: string): unknown }) {
    response.header('Cache-Control', 'no-store, max-age=0');
    response.header('Referrer-Policy', 'no-referrer');
    return { data: await this.comments.list(token, request.headers.cookie, await this.commentUser(auth)) };
  }
  @Post(':token/comments') @HttpCode(201) @UseGuards(OptionalClerkAuthGuard) async createComment(@Param('token') token: string, @Body() body: { displayName?: unknown; content?: unknown; anchor?: unknown }, @Req() request: FastifyRequest, @AuthContext() auth: AuthContextValue | undefined,
    @Res({ passthrough: true }) response: { header(name: string, value: string): unknown }) {
    response.header('Cache-Control', 'no-store, max-age=0');
    this.requireCommentMutation(request);
    try {
      const result = await this.comments.create(token, body, request.headers.cookie, request.headers['x-csrf-token'] as string | undefined, request.ip, await this.commentUser(auth));
      if (result.session) response.header('Set-Cookie', this.comments.cookieHeader(result.session));
      return { data: result.comment };
    } catch (error) {
      this.markRateLimit(error, request, response);
      throw error;
    }
  }
  @Post(':token/comments/claim') @HttpCode(200) @UseGuards(ClerkAuthGuard) async claimComments(@Param('token') token: string,
    @Req() request: FastifyRequest, @AuthContext() auth: AuthContextValue,
    @Res({ passthrough: true }) response: { header(name: string, value: string): unknown }) {
    response.header('Cache-Control', 'no-store, max-age=0');
    this.requireCommentMutation(request);
    return { data: await this.comments.claim(token, request.headers.cookie, request.headers['x-csrf-token'] as string | undefined, (await this.commentUser(auth))!) };
  }
  @Patch(':token/comments/:commentId') @HttpCode(200) @UseGuards(OptionalClerkAuthGuard) async editComment(@Param('token') token: string, @Param('commentId') commentId: string,
    @Body() body: { content?: unknown; expectedRevision?: unknown }, @Req() request: FastifyRequest, @AuthContext() auth: AuthContextValue | undefined,
    @Res({ passthrough: true }) response: { header(name: string, value: string): unknown }) {
    response.header('Cache-Control', 'no-store, max-age=0');
    this.requireCommentMutation(request);
    try {
      return { data: await this.comments.edit(token, commentId, body, request.headers.cookie, request.headers['x-csrf-token'] as string | undefined, request.ip, await this.commentUser(auth)) };
    } catch (error) {
      this.markRateLimit(error, request, response);
      throw error;
    }
  }
  @Get(':token/resources/:resourceId/content') async media(@Param('token') token: string, @Param('resourceId') resourceId: string, @Query('download') download: string | undefined, @Res({ passthrough: true }) response: { header(name: string, value: string): unknown }) {
    response.header('Cache-Control', 'no-store, max-age=0');
    response.header('X-Content-Type-Options', 'nosniff');
    response.header('Referrer-Policy', 'no-referrer');
    response.header('Cross-Origin-Resource-Policy', 'cross-origin');
    const file = await this.shares.getPublicMedia(token, resourceId);
    response.header('Content-Type', file.mediaType);
    response.header('Content-Disposition', `${download === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    return new StreamableFile(Readable.from(file.content));
  }
  @Get(':token') async get(@Param('token') token: string, @Res({ passthrough: true }) response: { header(name: string, value: string): unknown }) {
    response.header('Cache-Control', 'no-store, max-age=0');
    response.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    response.header('X-Content-Type-Options', 'nosniff');
    response.header('Referrer-Policy', 'no-referrer');
    return { data: await this.shares.getPublic(token) };
  }
}
