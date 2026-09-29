import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { Database } from '../src/infrastructure/database/database.js';
import { accounts, diagramRevisions, diagrams, folders, memberships, operationReceipts, projectResources, projects, resources, resourceVersions, users } from '../src/infrastructure/database/schema.js';
import { AccountService } from '../src/modules/account/account.service.js';
import { DiagramService } from '../src/modules/diagrams/diagram.service.js';
import { ImpactService } from '../src/modules/lifecycle/impact.service.js';
import { ProjectService } from '../src/modules/projects/project.service.js';
import { NoteService } from '../src/modules/resources/note.service.js';
import { ResourceKnowledgeRepository } from '../src/modules/resources/resource-knowledge.repository.js';

describe.runIf(Boolean(process.env.DATABASE_URL))('diagramas con PostgreSQL', () => {
  const database = new Database(); const accountService = new AccountService(database); const projectService = new ProjectService(database); const notes = new NoteService(database, new ResourceKnowledgeRepository(database)); const service = new DiagramService(database); const impacts = new ImpactService(database); const clerkId = `diagram_owner_${crypto.randomUUID()}`; let userId = ''; let accountId = ''; let projectId = ''; let resourceId = ''; const projectIds: string[] = [];
  afterAll(async () => { if (accountId) await database.db.delete(operationReceipts).where(eq(operationReceipts.accountId, accountId)); for (const id of projectIds) { const rows = await database.db.select({ id: diagrams.id }).from(diagrams).where(eq(diagrams.projectId, id)); for (const row of rows) await database.db.delete(diagramRevisions).where(eq(diagramRevisions.diagramId, row.id)); await database.db.delete(diagrams).where(eq(diagrams.projectId, id)); await database.db.delete(projectResources).where(eq(projectResources.projectId, id)); await database.db.delete(folders).where(eq(folders.projectId, id)); await database.db.delete(projects).where(eq(projects.id, id)); } if (resourceId) { await database.db.update(resources).set({ currentVersionId: null }).where(eq(resources.id, resourceId)); await database.db.delete(resourceVersions).where(eq(resourceVersions.resourceId, resourceId)); await database.db.delete(resources).where(eq(resources.id, resourceId)); } if (userId) { await database.db.delete(memberships).where(eq(memberships.userId, userId)); await database.db.delete(accounts).where(eq(accounts.personalOwnerUserId, userId)); await database.db.delete(users).where(eq(users.id, userId)); } await database.onModuleDestroy(); }, 30_000);
  it('crea vacío, renombra, duplica la composición y archiva con impacto', async () => {
    const identity = await accountService.ensureLocalUser({ clerkUserId: clerkId }); userId = identity.user.id; accountId = identity.account.id; const project = await projectService.create(accountId, 'Proyecto visual'); projectId = project.id; projectIds.push(project.id);
    const note = await notes.create(accountId, userId, { title: 'Fuente', content: '' }); resourceId = note.id;
    const created = await service.get(accountId, (await service.list(accountId, projectId, 'active'))[0]!.id); expect(created.document.nodes).toEqual([]); await expect(service.create(accountId, projectId, 'Otro mapa')).rejects.toThrow('ya tiene un mapa'); const document = { schemaVersion: 1, nodes: [{ id: 'n1', position: { x: 0, y: 0 }, data: { resourceId } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
    const key = crypto.randomUUID(); const saved = await service.save(accountId, created.id, { document, expectedRevision: 0, idempotencyKey: key }); expect(saved.revision).toBe(1);
    const repeated = await service.save(accountId, created.id, { document, expectedRevision: 0, idempotencyKey: key }); expect(repeated.revision).toBe(1);
    const referenced = await impacts.get(accountId, 'resource', resourceId, 'delete'); expect(referenced.deletionAllowed).toBe(false); expect(referenced.locations.some(location => location.includes('Proyecto visual'))).toBe(true);
    await expect(service.save(accountId, created.id, { document: { ...document, nodes: [{ ...document.nodes[0], data: { resourceId: crypto.randomUUID() } }] }, expectedRevision: 1, idempotencyKey: crypto.randomUUID() })).rejects.toThrow('Recurso del Canvas no encontrado');
    const folderDiagram = await service.duplicate(accountId, created.id, 'Carpetas'); projectIds.push(folderDiagram.projectId);
    const [folder] = await database.db.insert(folders).values({ projectId: folderDiagram.projectId, name: 'Fuentes' }).returning();
    const folderDocument = { ...document, background: { variant: 'grid', tone: 'surface' }, nodes: [{ id: 'folder-1', type: 'folder', position: { x: 0, y: 0 }, data: { folderId: folder.id, projectId: folderDiagram.projectId } }] };
    expect((await service.save(accountId, folderDiagram.id, { document: folderDocument, expectedRevision: 0, idempotencyKey: crypto.randomUUID() })).revision).toBe(1);
    expect((await service.get(accountId, folderDiagram.id)).document.background).toEqual({ variant: 'grid', tone: 'surface' });
    const folderCopy = await service.duplicate(accountId, folderDiagram.id); projectIds.push(folderCopy.projectId);
    expect((folderCopy.document.nodes[0] as { data: { folderId: string; projectId: string } }).data).toMatchObject({ projectId: folderCopy.projectId });
    expect((folderCopy.document.nodes[0] as { data: { folderId: string } }).data.folderId).not.toBe(folder.id);
    await expect(service.save(accountId, folderDiagram.id, { document: { ...folderDocument, background: { variant: 'danger', tone: 'surface' } }, expectedRevision: 1, idempotencyKey: crypto.randomUUID() })).rejects.toThrow('Documento de Canvas inválido');
    await expect(service.save(accountId, folderDiagram.id, { document: { ...folderDocument, nodes: [{ ...folderDocument.nodes[0], data: { folderId: crypto.randomUUID(), projectId: folderDiagram.projectId } }] }, expectedRevision: 1, idempotencyKey: crypto.randomUUID() })).rejects.toThrow('Carpeta del Canvas no encontrada');
    const [summary] = await service.list(accountId, projectId, 'active'); expect(summary).not.toHaveProperty('document');
    await expect(service.save(accountId, created.id, { document, expectedRevision: 0, idempotencyKey: crypto.randomUUID() })).rejects.toThrow('revisión remota cambió');
    expect((await database.db.select().from(diagramRevisions).where(eq(diagramRevisions.diagramId, created.id))).length).toBe(1);
    const renamed = await service.rename(accountId, created.id, 'Mapa principal'); expect(renamed.name).toBe('Mapa principal'); const copy = await service.duplicate(accountId, created.id); projectIds.push(copy.projectId); expect(copy.id).not.toBe(created.id); expect(copy.projectId).not.toBe(projectId); expect(copy.document).toEqual(document);
    const impact = await impacts.get(accountId, 'diagram', created.id, 'archive'); expect(impact.affected.resources).toBe(1); await impacts.execute(accountId, 'diagram', created.id, { action: 'archive', impactVersion: impact.impactVersion, confirmation: impact.confirmationPhrase, idempotencyKey: crypto.randomUUID() }); expect((await service.list(accountId, projectId, 'archived')).map(item => item.id)).toContain(created.id);
  }, 30_000);
});
