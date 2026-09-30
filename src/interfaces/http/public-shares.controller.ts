import { Body, Controller, ForbiddenException, Get, HttpCode, Inject, Param, Post, Query, Req, Res, StreamableFile, UnsupportedMediaTypeException } from '@nestjs/common';
import { Readable } from 'node:stream';
import type { FastifyRequest } from 'fastify';
import { parseEnvironmentList } from '../../config/environment.js';
import { DiagramShareService } from '../../modules/diagrams/diagram-share.service.js';
import { PublicCommentsService } from '../../modules/diagrams/public-comments.service.js';

@Controller('v1/public/shares')
export class PublicSharesController {
  constructor(@Inject(DiagramShareService) private readonly shares: DiagramShareService, @Inject(PublicCommentsService) private readonly comments: PublicCommentsService) {}
  @Get(':token/comments') async listComments(@Param('token') token: string, @Req() request: FastifyRequest, @Res({ passthrough: true }) response: { header(name: string, value: string): unknown }) {
    response.header('Cache-Control', 'no-store, max-age=0');
    response.header('Referrer-Policy', 'no-referrer');
    return { data: await this.comments.list(token, request.headers.cookie) };
  }
  @Post(':token/comments') @HttpCode(201) async createComment(@Param('token') token: string, @Body() body: { displayName?: unknown; content?: unknown }, @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: { header(name: string, value: string): unknown }) {
    response.header('Cache-Control', 'no-store, max-age=0');
    const origin = request.headers.origin;
    if (!origin || !parseEnvironmentList('WEB_ORIGINS').includes(origin)) throw new ForbiddenException('Origen de comentario no permitido.');
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new UnsupportedMediaTypeException('El comentario debe enviarse como JSON.');
    try {
      const result = await this.comments.create(token, body, request.headers.cookie, request.headers['x-csrf-token'] as string | undefined, request.ip);
      if (result.session) response.header('Set-Cookie', this.comments.cookieHeader(result.session));
      return { data: result.comment };
    } catch (error) {
      if (error instanceof Error && 'getStatus' in error && typeof error.getStatus === 'function' && error.getStatus() === 429) response.header('Retry-After', '60');
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
