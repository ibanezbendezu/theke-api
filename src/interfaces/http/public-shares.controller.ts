import { Controller, Get, Inject, Param, Res, StreamableFile } from '@nestjs/common';
import { Readable } from 'node:stream';
import { DiagramShareService } from '../../modules/diagrams/diagram-share.service.js';

@Controller('v1/public/shares')
export class PublicSharesController {
  constructor(@Inject(DiagramShareService) private readonly shares: DiagramShareService) {}
  @Get(':token/resources/:resourceId/content') async media(@Param('token') token: string, @Param('resourceId') resourceId: string, @Res({ passthrough: true }) response: { header(name: string, value: string): unknown }) {
    response.header('Cache-Control', 'no-store, max-age=0');
    response.header('X-Content-Type-Options', 'nosniff');
    response.header('Referrer-Policy', 'no-referrer');
    response.header('Cross-Origin-Resource-Policy', 'cross-origin');
    const file = await this.shares.getPublicMedia(token, resourceId);
    response.header('Content-Type', file.mediaType);
    response.header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
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
