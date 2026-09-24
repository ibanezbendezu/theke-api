import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { LinkRepository } from './link.repository.js';
import { MetadataFetchError, parsePublicHttpUrl } from './link-metadata.fetcher.js';

export interface LinkInput { url?: unknown; title?: unknown; description?: unknown }
function validTitle(value: unknown) { if (typeof value !== 'string' || !value.trim() || value.trim().length > 160) throw new BadRequestException('El título debe tener entre 1 y 160 caracteres.'); return value.trim(); }
function validDescription(value: unknown) { if (value != null && typeof value !== 'string') throw new BadRequestException('La descripción no es válida.'); if (typeof value === 'string' && value.length > 1000) throw new BadRequestException('La descripción debe tener hasta 1000 caracteres.'); return typeof value === 'string' ? value.trim() || null : null; }
function view(row: NonNullable<Awaited<ReturnType<LinkRepository['get']>>>) { return { id: row.id, title: row.title, description: row.description, type: 'link' as const, url: row.url, previewImageUrl: row.previewImageUrl, metadataStatus: row.metadataStatus, origin: row.url, status: 'ready' as const, updatedAt: row.updatedAt, mediaType: 'text/uri-list', byteSize: null, accessibilityText: null, accessibilityRequired: false, accessibilityMissing: false }; }

@Injectable()
export class LinkService {
  constructor(@Inject(LinkRepository) private readonly repository: LinkRepository) {}
  async create(accountId: string, authorUserId: string, input: LinkInput) { let url: URL; try { url = parsePublicHttpUrl(input.url); } catch (error) { if (error instanceof MetadataFetchError) throw new BadRequestException('Ingresa una URL HTTP o HTTPS válida.'); throw error; } return view((await this.repository.create(accountId, authorUserId, url.toString(), url.hostname))!); }
  async update(accountId: string, id: string, input: LinkInput) { const saved = await this.repository.update(accountId, id, validTitle(input.title), validDescription(input.description)); if (!saved) throw new NotFoundException('Enlace no encontrado.'); return view(saved); }
  async retry(accountId: string, id: string) { const saved = await this.repository.retry(accountId, id); if (!saved) throw new NotFoundException('Enlace no encontrado.'); return view(saved); }
}
