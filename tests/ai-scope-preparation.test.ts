import { describe, expect, it, vi } from 'vitest';
import { ScopePreparationService } from '../src/modules/ai/scope-preparation.service.js';

const diagramId = '11111111-1111-4111-8111-111111111111';
const first = '22222222-2222-4222-8222-222222222222';
const second = '33333333-3333-4333-8333-333333333333';
const groupId = 'group-1';

function setup(nodes: object[], rows: object[] = []) {
  const where = vi.fn().mockResolvedValue(rows);
  const select = vi.fn(() => ({ from: () => ({ leftJoin: () => ({ leftJoin: () => ({ leftJoin: () => ({ where }) }) }) }) }));
  const database = { db: { select, insert: vi.fn(), update: vi.fn() } };
  const diagrams = { get: vi.fn().mockResolvedValue({ archivedAt: null, document: { nodes } }) };
  const ai = { getStatus: vi.fn().mockResolvedValue({ quota: { maxInputTokens: 100 } }), recordUsage: vi.fn() };
  const service = new ScopePreparationService(database as never, diagrams as never, ai as never);
  return { service, database, diagrams, ai };
}

describe('preparación segura de grupos', () => {
  it('resuelve un grupo vacío desde el Diagrama y no invoca al proveedor ni escribe', async () => {
    const { service, database, diagrams, ai } = setup([{ id: groupId, type: 'container' }]);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const scope = await service.group('owner', { diagramId, groupId });
    expect(scope).toMatchObject({ resourceIds: [], excluded: [], available: false, reason: 'PROVIDER_PENDING' });
    expect(scope.limitations).toContain('El alcance está vacío.');
    expect(diagrams.get).toHaveBeenCalledWith('owner', diagramId);
    expect(database.db.insert).not.toHaveBeenCalled();
    expect(database.db.update).not.toHaveBeenCalled();
    expect(ai.recordUsage).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('excluye repetidos, nodos no analizables, recursos ajenos y límites sin exponer sus textos', async () => {
    const nodes = [{ id: groupId, type: 'container' },
      { id: 'one', type: 'resource', parentId: groupId, data: { resourceId: first } },
      { id: 'duplicate', type: 'resource', parentId: groupId, data: { resourceId: first } },
      { id: 'folder', type: 'folder', parentId: groupId, data: {} },
      { id: 'foreign', type: 'resource', parentId: groupId, data: { resourceId: second } },
      { id: 'other', type: 'resource', data: { resourceId: second } }];
    const { service } = setup(nodes, [{ id: first, type: 'note', content: 'Texto válido', accessibilityText: null, linkMetadataStatus: null }]);
    const scope = await service.group('owner', { diagramId, groupId });
    expect(scope.resourceIds).toEqual([first]);
    expect(scope.excluded).toEqual(expect.arrayContaining([
      { nodeId: 'duplicate', reason: 'Recurso repetido en el alcance.' },
      { nodeId: 'folder', reason: 'Representación sin Recurso analizable.' },
      { nodeId: 'foreign', reason: 'Recurso no disponible en esta Cuenta.' },
    ]));
    expect(JSON.stringify(scope)).not.toContain(second);
  });

  it('rechaza un Diagrama ajeno y un grupo inexistente', async () => {
    const { service, diagrams, database } = setup([{ id: groupId, type: 'container' }]);
    diagrams.get.mockRejectedValueOnce(new Error('Diagrama no encontrado.'));
    await expect(service.group('other', { diagramId, groupId })).rejects.toThrow('Diagrama no encontrado.');
    await expect(service.group('owner', { diagramId, groupId: 'unknown' })).rejects.toThrow('Grupo no encontrado');
    expect(database.db.select).not.toHaveBeenCalled();
  });

  it('excluye contenido sin texto y que supera el límite', async () => {
    const nodes = [{ id: groupId, type: 'container' }, { id: 'file', type: 'resource', parentId: groupId, data: { resourceId: first } }, { id: 'large', type: 'resource', parentId: groupId, data: { resourceId: second } }];
    const { service } = setup(nodes, [{ id: first, type: 'file', content: null, accessibilityText: '', linkMetadataStatus: null }, { id: second, type: 'note', content: 'x'.repeat(200), accessibilityText: null, linkMetadataStatus: null }]);
    const scope = await service.group('owner', { diagramId, groupId });
    expect(scope.resourceIds).toEqual([]);
    expect(scope.excluded.map(item => item.reason)).toEqual(['Sin texto accesible para análisis.', 'Límite de recursos o tokens superado.']);
  });

  it('verifica la selección contra el documento guardado y reutiliza las exclusiones', async () => {
    const nodes = [{ id: 'first-node', type: 'resource', data: { resourceId: first } }, { id: 'second-node', type: 'annotation' }];
    const { service, diagrams, database, ai } = setup(nodes, [{ id: first, type: 'note', content: 'Texto', accessibilityText: null, linkMetadataStatus: null }]);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    vi.stubEnv('OPENAI_API_KEY', 'present-but-unused');
    await expect(service.review('owner', { diagramId, nodeIds: ['not-saved'] })).rejects.toThrow('fuera del Diagrama guardado');
    expect(database.db.select).not.toHaveBeenCalled();
    const scope = await service.review('owner', { diagramId, nodeIds: ['first-node', 'second-node'] });
    expect(scope.resourceIds).toEqual([first]);
    expect(scope.excluded).toEqual([{ nodeId: 'second-node', reason: 'Representación sin Recurso analizable.' }]);
    expect(scope.available).toBe(false);
    expect(diagrams.get).toHaveBeenCalledWith('owner', diagramId);
    expect(ai.recordUsage).not.toHaveBeenCalled();
    expect(database.db.update).not.toHaveBeenCalled();
    expect(database.db.insert).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllEnvs(); vi.unstubAllGlobals();
  });

  it('una revisión completa no admite IDs ajenos a la Cuenta ni selección malformada', async () => {
    const nodes = [{ id: 'foreign', type: 'resource', data: { resourceId: second } }];
    const { service } = setup(nodes);
    expect((await service.review('owner', { diagramId })).resourceIds).toEqual([]);
    await expect(service.review('owner', { diagramId, nodeIds: Array(1001).fill('foreign') })).rejects.toThrow('inválido');
  });
});