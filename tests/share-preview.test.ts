import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SharePreviewService } from '../src/modules/diagrams/share-preview.service.js';

const resourceId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const relationId = '33333333-3333-4333-8333-333333333333';
const note = { id: resourceId, type: 'note', title: 'Nota', description: 'Descripción', content: 'Texto completo', url: null, accessibilityText: null, mediaType: null, properties: { secret: 'private' }, storageKey: 'private/key' };
const file = { id: otherId, type: 'file', title: 'Imagen', description: null, content: '', url: null, accessibilityText: 'Imagen accesible', mediaType: 'image/png' };
const relation = { id: relationId, sourceResourceId: resourceId, targetResourceId: otherId, direction: 'directed', typeKey: 'supports', label: 'Respalda', explanation: 'Explicación', provenance: 'private' };
const nodes = [{ id: 'n1', type: 'resource', data: { resourceId, privateReference: 'hidden' } }, { id: 'n2', type: 'resource', data: { resourceId: otherId } }, { id: 'folder', type: 'folder', data: { name: 'Private folder' } }];
const edges = [{ id: 'e1', source: 'n1', target: 'n2', data: { relationId, privateReference: 'hidden' } }];

function setup(input: { nodes?: object[]; edges?: object[]; resourceRows?: object[]; relationRows?: object[]; rejected?: boolean } = {}) {
  const where = vi.fn().mockImplementationOnce(async () => input.resourceRows ?? [note, file]).mockImplementationOnce(async () => input.relationRows ?? [relation]);
  const select = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    for (const key of ['from', 'innerJoin', 'leftJoin']) chain[key] = vi.fn(() => chain);
    chain.where = where;
    return chain;
  });
  const database = { db: { select, insert: vi.fn(), update: vi.fn(), delete: vi.fn(), transaction: vi.fn() } };
  const diagrams = { get: vi.fn().mockImplementation(async () => {
    if (input.rejected) throw new NotFoundException('Diagrama no encontrado.');
    return { name: 'Mapa', revision: 7, archivedAt: null, projectId: 'private-project', document: { nodes: input.nodes ?? nodes, edges: input.edges ?? edges, viewport: { x: 8, y: 9, zoom: 2 }, background: { variant: 'grid' } } };
  }) };
  return { service: new SharePreviewService(database as never, diagrams as never), database, diagrams, select };
}

describe('preview privado de diagramas', () => {
  it('rechaza diagramas ajenos antes de consultar recursos', async () => {
    const { service, database, diagrams } = setup({ rejected: true });
    await expect(service.get('other-account', 'diagram')).rejects.toBeInstanceOf(NotFoundException);
    expect(diagrams.get).toHaveBeenCalledWith('other-account', 'diagram');
    expect(database.db.select).not.toHaveBeenCalled();
  });

  it('proyecta solo recursos y relaciones representados, sin metadatos privados ni mutaciones', async () => {
    const { service, database, select } = setup({ resourceRows: [note, file, { ...note, id: 'unrelated', title: 'Unrelated' }], relationRows: [relation, { ...relation, id: 'unrelated' }] });
    const preview = await service.get('owner', 'diagram');
    expect(preview).toEqual({ diagramName: 'Mapa', revision: 7, resources: [
      { id: resourceId, title: 'Nota', type: 'note', description: 'Descripción', content: 'Texto completo', url: null, accessibilityText: null, mediaType: null },
      { id: otherId, title: 'Imagen', type: 'file', description: null, content: null, url: null, accessibilityText: 'Imagen accesible', mediaType: 'image/png' },
    ], relations: [{ id: relationId, sourceResourceId: resourceId, targetResourceId: otherId, direction: 'directed', typeKey: 'supports', label: 'Respalda', explanation: 'Explicación' }], warnings: [], ready: true });
    expect(JSON.stringify(preview)).not.toMatch(/private|secret|storageKey|versionId|projectId|folder|viewport|Unrelated|provenance/);
    expect(select).toHaveBeenCalledTimes(2);
    expect(database.db.insert).not.toHaveBeenCalled();
    expect(database.db.update).not.toHaveBeenCalled();
    expect(database.db.delete).not.toHaveBeenCalled();
    expect(database.db.transaction).not.toHaveBeenCalled();
  });

  it.each([
    { resourceRows: [file], relationRows: [relation] },
    { resourceRows: [note, { ...file, archivedAt: new Date() }], relationRows: [relation] },
    { resourceRows: [note, file], relationRows: [] },
    { resourceRows: [note, file], relationRows: [{ ...relation, archivedAt: new Date() }] },
    { resourceRows: [note, file], relationRows: [{ ...relation, sourceResourceId: otherId }] },
  ])('falla cerrado ante recursos o relaciones inválidos', async input => {
    const { service } = setup(input);
    await expect(service.get('owner', 'diagram')).rejects.toBeInstanceOf(ConflictException);
  });

  it('advierte si falta accesibilidad o el formato de archivo no es compatible', async () => {
    const { service } = setup({ resourceRows: [note, { ...file, accessibilityText: '  ', mediaType: 'application/x-executable' }] });
    const preview = await service.get('owner', 'diagram');
    expect(preview.ready).toBe(false);
    expect(preview.warnings).toEqual([
      { resourceId: otherId, field: 'accessibilityText', message: expect.any(String) },
      { resourceId: otherId, field: 'mediaType', message: expect.any(String) },
    ]);
  });

  it('devuelve la URL explícita del enlace sin incluir la miniatura ni los campos internos', async () => {
    const link = { ...file, type: 'link', url: 'https://example.org/article', previewImageUrl: 'https://private.example/thumbnail', mediaType: null, accessibilityText: null };
    const { service } = setup({ resourceRows: [note, link] });
    const preview = await service.get('owner', 'diagram');
    expect(preview.resources[1]).toEqual({ id: otherId, title: 'Imagen', type: 'link', description: null, content: null, url: 'https://example.org/article', accessibilityText: null, mediaType: null });
    expect(JSON.stringify(preview)).not.toContain('thumbnail');
  });

  it('permite diagramas vacíos sin consultar registros adicionales', async () => {
    const { service, database } = setup({ nodes: [], edges: [] });
    expect(await service.get('owner', 'diagram')).toEqual({ diagramName: 'Mapa', revision: 7, resources: [], relations: [], warnings: [], ready: true });
    expect(database.db.select).not.toHaveBeenCalled();
  });

  it('solo incluye relaciones cuyas aristas corresponden a nodos representados', async () => {
    const { service } = setup({ edges: [{ ...edges[0], source: 'folder' }] });
    await expect(service.get('owner', 'diagram')).rejects.toBeInstanceOf(ConflictException);
  });

  it('no expone representaciones ocultas ni sus relaciones', async () => {
    const { service } = setup({ nodes: [nodes[0], { ...nodes[1], hidden: true }], edges });
    const preview = await service.get('owner', 'diagram');
    expect(preview.resources.map(item => item.id)).toEqual([resourceId]);
    expect(preview.relations).toEqual([]);
  });

  it('no expone referencias wiki a recursos privados desde el contenido de una nota', async () => {
    const { service } = setup({ resourceRows: [{ ...note, content: `Texto [[resource:${relationId}|Nota privada]]` }, file] });
    await expect(service.get('owner', 'diagram')).rejects.toBeInstanceOf(ConflictException);
  });
});
