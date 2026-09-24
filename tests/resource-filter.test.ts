import { describe, expect, it, vi } from 'vitest';
import { ResourceService } from '../src/modules/resources/resource.service.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const folderId = '22222222-2222-4222-8222-222222222222';
const row = (index: number) => ({ id: `resource-${index}`, title: `Recurso ${index}`, description: null, type: 'note' as const, creationMethod: 'manual' as const, updatedAt: new Date(2026, 0, 1, 0, 0, 30 - index), versionId: `version-${index}`, content: '', storageKey: null, mediaType: null, byteSize: null, accessibilityText: null, url: null, previewImageUrl: null, metadataStatus: null });

describe('filtros de recursos', () => {
  it('combina búsqueda, tipo, proyecto y carpeta', async () => {
    const repository = { list: vi.fn().mockResolvedValue([row(1)]), get: vi.fn(), setAccessibility: vi.fn() };
    const service = new ResourceService(repository as never, {} as never);
    await service.list('account-1', { query: '  fuente  ', type: 'link', projectId, folderId });
    expect(repository.list).toHaveBeenCalledWith('account-1', { query: 'fuente', type: 'link', status: 'active', projectId, folderId, cursor: undefined });
  });

  it('rechaza filtros inválidos', async () => {
    const service = new ResourceService({} as never, {} as never);
    await expect(service.list('account-1', { type: 'video' })).rejects.toThrow('tipo');
    await expect(service.list('account-1', { folderId })).rejects.toThrow('proyecto');
    await expect(service.list('account-1', { projectId: 'no-uuid' })).rejects.toThrow('filtro');
  });

  it('genera y recupera un cursor estable por fecha e identificador', async () => {
    const repository = { list: vi.fn().mockResolvedValue(Array.from({ length: 21 }, (_, index) => row(index))), get: vi.fn(), setAccessibility: vi.fn() };
    const service = new ResourceService(repository as never, {} as never); const first = await service.list('account-1');
    expect(first.data).toHaveLength(20); expect(first.meta.nextCursor).toBeTruthy();
    await service.list('account-1', { cursor: first.meta.nextCursor! });
    expect(repository.list.mock.calls[1]?.[1].cursor).toEqual([row(19).updatedAt, 'resource-19']);
  });
});
