import { Inject, Injectable } from '@nestjs/common';
import { LinkMetadataFetcher, MetadataFetchError } from './link-metadata.fetcher.js';
import { LinkRepository } from './link.repository.js';

@Injectable()
export class LinkProcessor {
  constructor(@Inject(LinkRepository) private readonly repository: LinkRepository, @Inject(LinkMetadataFetcher) private readonly fetcher: LinkMetadataFetcher) {}
  async process(resourceId: string, requestedAtValue: string) { const requestedAt = new Date(requestedAtValue); const link = await this.repository.internal(resourceId); if (!link || link.requestedAt.getTime() !== requestedAt.getTime()) return; try { await this.repository.complete(resourceId, requestedAt, await this.fetcher.fetch(link.url)); } catch (error) { const reason = error instanceof MetadataFetchError ? error.code : 'unexpected_error'; console.warn('link-metadata:', { resourceId, reason }); await this.repository.fail(resourceId, requestedAt, reason); } }
}
