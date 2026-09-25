import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { Database } from '../src/infrastructure/database/database.js';
import { accounts, diagramRevisions, diagrams, memberships, projects, relationEvidence, relationTypes, relations, resources, resourceVersions, users } from '../src/infrastructure/database/schema.js';
import { AccountService } from '../src/modules/account/account.service.js';
import { ProjectService } from '../src/modules/projects/project.service.js';
import { NoteService } from '../src/modules/resources/note.service.js';
import { DiagramService } from '../src/modules/diagrams/diagram.service.js';
import { RelationService } from '../src/modules/relations/relation.service.js';

describe.runIf(Boolean(process.env.DATABASE_URL))('relaciones con PostgreSQL', () => {
  const database = new Database();
  const accountsService = new AccountService(database);
  const projectsService = new ProjectService(database);
  const notes = new NoteService(database);
  const diagramService = new DiagramService(database);
  const service = new RelationService(database);
  let userId = ''; let accountId = ''; let diagramId = ''; let foreignUserId = ''; let foreignAccountId = '';
  const projectIds: string[] = []; const resourceIds: string[] = [];
  afterAll(async () => {
    if (accountId) { const ownedRelations = await database.db.select({ id: relations.id }).from(relations).where(eq(relations.accountId, accountId)); for (const relation of ownedRelations) await database.db.delete(relationEvidence).where(eq(relationEvidence.relationId, relation.id)); await database.db.delete(relations).where(eq(relations.accountId, accountId)); await database.db.delete(relationTypes).where(eq(relationTypes.accountId, accountId)); }
    if (diagramId) { await database.db.delete(diagramRevisions).where(eq(diagramRevisions.diagramId, diagramId)); await database.db.delete(diagrams).where(eq(diagrams.id, diagramId)); }
    for (const resourceId of resourceIds) { await database.db.update(resources).set({ currentVersionId: null }).where(eq(resources.id, resourceId)); await database.db.delete(resourceVersions).where(eq(resourceVersions.resourceId, resourceId)); await database.db.delete(resources).where(eq(resources.id, resourceId)); }
    for (const projectId of projectIds) await database.db.delete(projects).where(eq(projects.id, projectId));
    if (userId) { await database.db.delete(memberships).where(eq(memberships.userId, userId)); await database.db.delete(accounts).where(eq(accounts.personalOwnerUserId, userId)); await database.db.delete(users).where(eq(users.id, userId)); }
    if (foreignUserId) { await database.db.delete(memberships).where(eq(memberships.userId, foreignUserId)); await database.db.delete(accounts).where(eq(accounts.personalOwnerUserId, foreignUserId)); await database.db.delete(users).where(eq(users.id, foreignUserId)); }
    await database.onModuleDestroy();
  }, 30_000);

  it('crea relación canónica y arista local sin duplicar, y limita tipos personalizados al proyecto', async () => {
    const identity = await accountsService.ensureLocalUser({ clerkUserId: `relation_${crypto.randomUUID()}` }); userId = identity.user.id; accountId = identity.account.id;
    const project = await projectsService.create(accountId, 'Relaciones'); projectIds.push(project.id);
    const another = await projectsService.create(accountId, 'Otro proyecto'); projectIds.push(another.id);
    const first = await notes.create(accountId, userId, { title: 'Origen', content: '' }); resourceIds.push(first.id);
    const second = await notes.create(accountId, userId, { title: 'Destino', content: '' }); resourceIds.push(second.id);
    const diagram = await diagramService.create(accountId, project.id, 'Mapa'); diagramId = diagram.id;
    const document = { schemaVersion: 1, nodes: [{ id: 'n1', type: 'resource', position: { x: 0, y: 0 }, data: { resourceId: first.id } }, { id: 'n2', type: 'resource', position: { x: 100, y: 0 }, data: { resourceId: second.id } }, { id: 'visual', type: 'annotation', position: { x: 0, y: 100 }, data: { text: 'Nota' } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
    await diagramService.save(accountId, diagram.id, { document, expectedRevision: 0, idempotencyKey: crypto.randomUUID() });
    const create = { sourceNodeId: 'n1', targetNodeId: 'n2', direction: 'directed', typeKey: 'supports', expectedRevision: 1, idempotencyKey: crypto.randomUUID() };
    const result = await service.create(accountId, userId, diagram.id, create);
    expect(result.revision).toBe(2); expect(result.edgeId).not.toBe(result.relationId);
    expect((result.document.edges as { data: { relationId: string } }[])[0].data.relationId).toBe(result.relationId);
    expect((await service.create(accountId, userId, diagram.id, create)).relationId).toBe(result.relationId);
    await expect(service.create(accountId, userId, diagram.id, { ...create, expectedRevision: 2, idempotencyKey: crypto.randomUUID() })).rejects.toThrow('equivalente');
    const reused = await service.create(accountId, userId, diagram.id, { ...create, expectedRevision: 2, idempotencyKey: crypto.randomUUID(), reuseExisting: true }); expect(reused.revision).toBe(2);
    await expect(service.create(accountId, userId, diagram.id, { ...create, sourceNodeId: 'visual', expectedRevision: 2, idempotencyKey: crypto.randomUUID() })).rejects.toThrow('solo conectan Recursos');
    const custom = await service.create(accountId, userId, diagram.id, { ...create, typeKey: 'custom', customTypeName: 'Contextualiza', expectedRevision: 2, idempotencyKey: crypto.randomUUID() });
    expect(custom.revision).toBe(3);
    expect((await service.types(accountId, project.id)).some(type => type.label === 'Contextualiza')).toBe(true);
    expect((await service.types(accountId, another.id)).some(type => type.label === 'Contextualiza')).toBe(false);
    const forged = { ...custom.document, edges: [{ ...(custom.document.edges[0] as object), target: 'visual' }, custom.document.edges[1]] };
    await expect(diagramService.save(accountId, diagram.id, { document: forged, expectedRevision: 3, idempotencyKey: crypto.randomUUID() })).rejects.toThrow('extremos visuales');
    const saved = await diagramService.save(accountId, diagram.id, { document: custom.document, expectedRevision: 3, idempotencyKey: crypto.randomUUID() });
    expect(saved.revision).toBe(4);
    const detail = await service.get(accountId, result.relationId);
    expect(detail.source.title).toBe('Origen'); expect(detail.revision).toBe(0); expect(detail.createdByUserId).toBe(userId);
    const needs = await service.update(accountId, userId, result.relationId, { label: 'Apoya la hipótesis', explanation: 'Falta respaldo directo', provenance: 'Interpretación propia', evidenceStatus: 'needs_evidence', evidence: [], expectedRevision: 0 });
    expect(needs.revision).toBe(1); expect(needs.evidenceStatus).toBe('needs_evidence'); expect(needs.updatedByUserId).toBe(userId);
    await expect(service.update(accountId, userId, result.relationId, { label: 'Otra', explanation: '', provenance: '', evidenceStatus: 'none', evidence: [], expectedRevision: 0 })).rejects.toThrow('otra sesión');
    const cited = await service.update(accountId, userId, result.relationId, { label: 'Apoya la hipótesis', explanation: 'La nota incluye el dato', provenance: 'Lectura manual', evidenceStatus: 'confirmed', evidence: [{ resourceId: second.id, excerpt: 'Dato relevante', note: 'Página 2' }], expectedRevision: 1 });
    expect(cited.revision).toBe(2); expect(cited.evidence[0]).toMatchObject({ resourceId: second.id, excerpt: 'Dato relevante', note: 'Página 2' });
    const foreignIdentity = await accountsService.ensureLocalUser({ clerkUserId: `foreign_relation_${crypto.randomUUID()}` }); foreignUserId = foreignIdentity.user.id; foreignAccountId = foreignIdentity.account.id;
    const foreign = await notes.create(foreignAccountId, foreignUserId, { title: 'Ajeno', content: '' }); resourceIds.push(foreign.id);
    await expect(service.update(accountId, userId, result.relationId, { label: '', explanation: '', provenance: '', evidenceStatus: 'confirmed', evidence: [{ resourceId: foreign.id }], expectedRevision: 2 })).rejects.toThrow('no encontrado en esta Cuenta');
  }, 30_000);
});
