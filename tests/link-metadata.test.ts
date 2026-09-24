import { afterEach, describe, expect, it, vi } from 'vitest';
import { LinkMetadataFetcher, MetadataFetchError, parsePublicHttpUrl } from '../src/modules/resources/link-metadata.fetcher.js';
import { LinkProcessor } from '../src/modules/resources/link.processor.js';

afterEach(() => vi.unstubAllGlobals());

describe('metadatos seguros de enlaces', () => {
  it('solo acepta direcciones HTTP o HTTPS sin credenciales', () => {
    expect(parsePublicHttpUrl('https://example.com/x').hostname).toBe('example.com');
    expect(() => parsePublicHttpUrl('file:///etc/passwd')).toThrow(MetadataFetchError);
    expect(() => parsePublicHttpUrl('http://user:secret@example.com')).toThrow(MetadataFetchError);
  });

  it('rechaza destinos privados antes de hacer una solicitud', async () => {
    const request = vi.fn(); vi.stubGlobal('fetch', request);
    await expect(new LinkMetadataFetcher().fetch('http://127.0.0.1/admin')).rejects.toMatchObject({ code: 'private_destination' });
    expect(request).not.toHaveBeenCalled();
  });

  it('limita la respuesta y extrae metadatos sin ejecutar HTML', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html><head><title>Fuente útil</title><meta name="description" content="Resumen"><meta property="og:image" content="/cover.png"></head></html>', { headers: { 'content-type': 'text/html' } })));
    await expect(new LinkMetadataFetcher().fetch('https://93.184.216.34/article')).resolves.toEqual({ title: 'Fuente útil', description: 'Resumen', previewImageUrl: 'https://93.184.216.34/cover.png' });
  });

  it('conserva el recurso y registra un fallo técnico controlado', async () => {
    const requestedAt = new Date(); const repository = { internal: vi.fn().mockResolvedValue({ url: 'https://example.com', requestedAt }), complete: vi.fn(), fail: vi.fn() }; const fetcher = { fetch: vi.fn().mockRejectedValue(new MetadataFetchError('request_failed')) };
    await new LinkProcessor(repository as never, fetcher as never).process('resource-1', requestedAt.toISOString());
    expect(repository.fail).toHaveBeenCalledWith('resource-1', requestedAt, 'request_failed');
    expect(repository.complete).not.toHaveBeenCalled();
  });
});
