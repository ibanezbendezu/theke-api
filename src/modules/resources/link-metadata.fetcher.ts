import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Injectable } from '@nestjs/common';

const MAX_BYTES = 1_048_576;
const MAX_REDIRECTS = 3;
export class MetadataFetchError extends Error { constructor(readonly code: string) { super(code); } }

function privateIp(address: string) {
  const normalized = address.toLowerCase().replace(/^::ffff:/, '');
  if (normalized.includes(':')) return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb');
  const octets = normalized.split('.').map(Number); const [a, b] = octets;
  return octets.length !== 4 || a === 0 || a === 10 || a === 127 || (a === 100 && b! >= 64 && b! <= 127) || (a === 169 && b === 254) || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a! >= 224;
}

export function parsePublicHttpUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048) throw new MetadataFetchError('invalid_url');
  let url: URL; try { url = new URL(value.trim()); } catch { throw new MetadataFetchError('invalid_url'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname) throw new MetadataFetchError('forbidden_url');
  return url;
}

async function assertPublic(url: URL) {
  if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) throw new MetadataFetchError('private_destination');
  const addresses = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true, verbatim: true }).catch(() => { throw new MetadataFetchError('dns_failed'); });
  if (!addresses.length || addresses.some(value => privateIp(value.address))) throw new MetadataFetchError('private_destination');
}
function value(html: string, property: string) { const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const a = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'i').exec(html)?.[1]; const b = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i').exec(html)?.[1]; return (a ?? b)?.trim(); }
function clean(text?: string) { return text?.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim(); }

@Injectable()
export class LinkMetadataFetcher {
  async fetch(input: string) {
    let url = parsePublicHttpUrl(input);
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      await assertPublic(url);
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5_000), headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'ThekeMetadata/1.0' } }).catch(() => { throw new MetadataFetchError('request_failed'); });
      if (response.status >= 300 && response.status < 400) { const location = response.headers.get('location'); if (!location || redirects === MAX_REDIRECTS) throw new MetadataFetchError('redirect_limit'); url = parsePublicHttpUrl(new URL(location, url).toString()); continue; }
      if (!response.ok) throw new MetadataFetchError('http_error');
      if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('html')) throw new MetadataFetchError('invalid_content');
      const declared = Number(response.headers.get('content-length')); if (declared > MAX_BYTES) throw new MetadataFetchError('content_too_large');
      const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      while (reader) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > MAX_BYTES) { await reader.cancel(); throw new MetadataFetchError('content_too_large'); } chunks.push(part.value); }
      const html = new TextDecoder().decode(Buffer.concat(chunks));
      const title = clean(value(html, 'og:title') ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]);
      const description = clean(value(html, 'og:description') ?? value(html, 'description'));
      const image = value(html, 'og:image');
      let previewImageUrl: string | undefined;
      if (image) { try { const candidate = parsePublicHttpUrl(new URL(image, url).toString()); await assertPublic(candidate); previewImageUrl = candidate.toString().slice(0, 2048); } catch { previewImageUrl = undefined; } }
      return { title: title?.slice(0, 160), description: description?.slice(0, 1000), previewImageUrl };
    }
    throw new MetadataFetchError('redirect_limit');
  }
}
