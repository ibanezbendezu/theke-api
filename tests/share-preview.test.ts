import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SharePreviewService } from '../src/modules/diagrams/share-preview.service.js';

const resourceId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const relationId = '33333333-3333-4333-8333-333333333333';
const note = { id: resourceId, versionId: 'note-version-1', type: 'note', title: 'Nota', description: 'Descripción', content: 'Texto completo', url: null, accessibilityText: null, mediaType: null, properties: { secret: 'private' }, storageKey: null };
const file = { id: otherId, versionId: 'file-version-1', type: 'file', title: 'Imagen', description: null, content: '', url: null, accessibilityText: 'Imagen accesible', mediaType: 'image/png', storageKey: 'private/file' };
const relation = { id: relationId, sourceResourceId: resourceId, targetResourceId: otherId, direction: 'directed', typeKey: 'supports', label: 'Respalda', explanation: 'Explicación', provenance: 'private' };
const nodes = [{ id: 'n1', type: 'resource', position: { x: 10, y: 20 }, data: { resourceId, privateReference: 'hidden' } }, { id: 'n2', type: 'resource', position: { x: 200, y: 80 }, data: { resourceId: otherId } }, { id: 'folder', type: 'container', position: { x: 300, y: 0 }, width: 400, height: 260, data: { label: 'Grupo visible', privateReference: 'hidden' } }];
const edges = [{ id: 'e1', source: 'n1', target: 'n2', data: { relationId, privateReference: 'hidden' } }];

function setup(input: { nodes?: object[]; edges?: object[]; resourceRows?: object[]; folderRows?: object[]; folderCountRows?: object[]; relationRows?: object[]; customTypeRows?: object[]; evidenceRows?: object[]; rejected?: boolean } = {}) {
  const responses = [input.resourceRows ?? [note, file], ...(input.folderRows ? [input.folderRows, input.folderCountRows ?? []] : []), input.relationRows ?? [relation], ...(input.customTypeRows ? [input.customTypeRows] : []), input.evidenceRows ?? []];
  const where = vi.fn();
  for (const response of responses) where.mockImplementationOnce(async () => response);
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
    expect(diagrams.get).toHaveBeenCalledWith('other-account', 'diagram', database.db);
    expect(database.db.select).not.toHaveBeenCalled();
  });

  it('proyecta solo recursos y relaciones representados, sin metadatos privados ni mutaciones', async () => {
    const { service, database, select } = setup({ resourceRows: [note, file, { ...note, id: 'unrelated', title: 'Unrelated' }], relationRows: [relation, { ...relation, id: 'unrelated' }] });
    const preview = await service.get('owner', 'diagram');
    expect(preview).toEqual({ diagramName: 'Mapa', revision: 7, resources: [
      { id: resourceId, title: 'Nota', type: 'note', description: 'Descripción', content: 'Texto completo', url: null, accessibilityText: null, mediaType: null },
      { id: otherId, title: 'Imagen', type: 'file', description: null, content: null, url: null, accessibilityText: 'Imagen accesible', mediaType: 'image/png' },
    ], relations: [{ id: relationId, sourceResourceId: resourceId, targetResourceId: otherId, direction: 'directed', typeKey: 'supports', typeLabel: 'Respalda', label: 'Respalda', explanation: 'Explicación', evidence: [] }],
      layout: { background: { variant: 'grid', tone: 'default' }, nodes: [{ id: 'n0', type: 'resource', resourceId, x: 10, y: 20 }, { id: 'n1', type: 'resource', resourceId: otherId, x: 200, y: 80 }, { id: 'n2', type: 'container', x: 300, y: 0, width: 400, height: 260, label: 'Grupo visible' }], edges: [{ id: 'e0', relationId, source: 'n0', target: 'n1' }] },
      fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/), warnings: [], ready: true });
    expect(JSON.stringify(preview)).not.toMatch(/private|secret|storageKey|versionId|projectId|folder|viewport|Unrelated|provenance/);
    expect(select).toHaveBeenCalledTimes(3);
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
    expect(await service.get('owner', 'diagram')).toEqual({ diagramName: 'Mapa', revision: 7, resources: [], relations: [], layout: { background: { variant: 'grid', tone: 'default' }, nodes: [], edges: [] }, fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/), warnings: [], ready: true });
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

  it('incluye el nombre del tipo personalizado en la proyección pública', async () => {
    const typeId = '44444444-4444-4444-8444-444444444444';
    const { service } = setup({ relationRows: [{ ...relation, typeKey: `custom:${typeId}`, label: null }], customTypeRows: [{ id: typeId, label: 'Contextualiza smoke' }] });
    const preview = await service.get('owner', 'diagram');
    expect(preview.relations[0]).toMatchObject({ typeKey: `custom:${typeId}`, typeLabel: 'Contextualiza smoke', label: null });
    expect(JSON.stringify(preview)).not.toContain('private-project');
  });

  it('publica posiciones absolutas y solo evidencia de recursos representados', async () => {
    const nested = { ...nodes[1], parentId: 'folder', position: { x: 20, y: 30 } };
    const { service } = setup({ nodes: [nodes[0], nested, nodes[2]], evidenceRows: [
      { id: 'a', relationId, resourceId, excerpt: 'Cita visible', note: 'Página revisada', pageNumber: 2 },
      { id: 'b', relationId, resourceId: '44444444-4444-4444-8444-444444444444', excerpt: 'Cita privada' },
    ] });
    const preview = await service.get('owner', 'diagram');
    expect(preview.layout.nodes[1]).toEqual({ id: 'n1', type: 'resource', resourceId: otherId, x: 320, y: 30 });
    expect(preview.relations[0]?.evidence).toEqual([{ resourceId, excerpt: 'Cita visible', note: 'Página revisada', pageNumber: 2 }]);
    expect(JSON.stringify(preview)).not.toContain('Cita privada');
  });

  it('publica carpetas y anotaciones visibles con campos permitidos', async () => {
    const folderId = '44444444-4444-4444-8444-444444444444';
    const folderNode = { id: 'folder-1', type: 'folder', position: { x: 40, y: 50 }, width: 310, height: 120, data: { folderId, caption: 'Fuentes', privatePath: '/secret' } };
    const annotation = { id: 'annotation-1', type: 'annotation', position: { x: 60, y: 90 }, data: { kind: 'text', text: 'Lectura visible', privateNote: 'oculta' } };
    const { service } = setup({ nodes: [nodes[0], folderNode, annotation], edges: [], folderRows: [{ id: folderId, name: 'Documentos' }], folderCountRows: [{ folderId }] });
    const preview = await service.get('owner', 'diagram');
    expect(preview.layout.nodes[1]).toEqual({ id: 'n1', type: 'folder', x: 40, y: 50, width: 310, height: 120, folderName: 'Documentos', folderCount: 1, caption: 'Fuentes' });
    expect(preview.layout.nodes[2]).toEqual({ id: 'n2', type: 'annotation', x: 60, y: 90, annotationKind: 'text', text: 'Lectura visible' });
    expect(JSON.stringify(preview)).not.toMatch(/privatePath|privateNote|secret|oculta/);
  });

  it('publica el estilo del texto visual sin filtrar datos arbitrarios', async () => {
    const annotation = { id: 'visual-text', type: 'annotation', position: { x: 60, y: 90 }, zIndex: 4,
      data: { kind: 'text', text: 'Uno\nDos', fontFamily: 'georgia', fontSize: 32, textColor: '#d44c47', bold: true,
        italic: true, underline: true, strike: true, textCase: 'upper', align: 'justify', listStyle: 'number',
        letterSpacing: 1.5, lineHeight: 1.8, opacity: 65, rotation: 45, shadow: 'soft', outlineWidth: 2,
        outlineColor: '#222222', backgroundColor: '#ffffff', cornerRadius: 12,
        privateNote: 'no publicar', unsafeColor: 'url(https://private.example)' } };
    const preview = await setup({ nodes: [annotation], edges: [], resourceRows: [], relationRows: [] }).service.get('owner', 'diagram');
    expect(preview.layout.nodes[0]).toMatchObject({ type: 'annotation', zIndex: 4, text: 'Uno\nDos', fontFamily: 'georgia',
      fontSize: 32, textColor: '#d44c47', bold: true, italic: true, underline: true, strike: true,
      textCase: 'upper', align: 'justify', listStyle: 'number', letterSpacing: 1.5, lineHeight: 1.8,
      opacity: 65, rotation: 45, shadow: 'soft', outlineWidth: 2, outlineColor: '#222222', backgroundColor: '#ffffff', cornerRadius: 12 });
    expect(JSON.stringify(preview)).not.toMatch(/privateNote|unsafeColor|private\.example|no publicar/);
  });

  it('conserva el fondo transparente y el contorno de grosor cero en formas públicas', async () => {
    const shape = { id: 'visual-shape', type: 'annotation', position: { x: 20, y: 30 },
      data: { kind: 'shape', shape: 'rectangle', backgroundColor: 'transparent', thickness: 0 } };
    const preview = await setup({ nodes: [shape], edges: [], resourceRows: [], relationRows: [] }).service.get('owner', 'diagram');
    expect(preview.layout.nodes[0]).toMatchObject({ annotationKind: 'shape', backgroundColor: 'transparent', thickness: 0 });
  });

  it('cambia la huella al editar una anotación y rechaza elementos visuales desconocidos', async () => {
    const annotation = { id: 'a1', type: 'annotation', position: { x: 1, y: 2 }, data: { kind: 'text', text: 'Antes' } };
    const first = await setup({ nodes: [nodes[0], annotation], edges: [] }).service.get('owner', 'diagram');
    const second = await setup({ nodes: [nodes[0], { ...annotation, data: { kind: 'text', text: 'Después' } }], edges: [] }).service.get('owner', 'diagram');
    expect(first.fingerprint).not.toBe(second.fingerprint);
    await expect(setup({ nodes: [{ id: 'unknown', type: 'private-widget', position: { x: 0, y: 0 }, data: { secret: true } }], edges: [] }).service.get('owner', 'diagram')).rejects.toBeInstanceOf(ConflictException);
  });

  it('oculta recursos contenidos en un grupo oculto', async () => {
    const { service } = setup({ nodes: [nodes[0], { ...nodes[1], parentId: 'folder' }, { ...nodes[2], hidden: true }], edges });
    const preview = await service.get('owner', 'diagram');
    expect(preview.resources.map(item => item.id)).toEqual([resourceId]);
    expect(preview.layout.edges).toEqual([]);
  });

  it('cambia la huella cuando cambia una revisión o el contenido público canónico', async () => {
    const first = await setup().service.get('owner', 'diagram');
    const second = await setup({ resourceRows: [{ ...note, content: 'Nuevo texto' }, file] }).service.get('owner', 'diagram');
    expect(first.fingerprint).not.toBe(second.fingerprint);
    expect((await setup().service.get('owner', 'diagram')).fingerprint).toBe(first.fingerprint);
  });

  it('mantiene la misma huella si PostgreSQL devuelve las citas en otro orden', async () => {
    const first = { id: 'a', relationId, resourceId, excerpt: 'Primera cita', note: null, pageNumber: null };
    const second = { id: 'b', relationId, resourceId: otherId, excerpt: 'Segunda cita', note: null, pageNumber: 2 };
    const one = await setup({ evidenceRows: [first, second] }).service.get('owner', 'diagram');
    const two = await setup({ evidenceRows: [second, first] }).service.get('owner', 'diagram');
    expect(one.fingerprint).toBe(two.fingerprint);
    expect(one.relations[0]?.evidence?.map(item => item.excerpt)).toEqual(['Primera cita', 'Segunda cita']);
  });
});
