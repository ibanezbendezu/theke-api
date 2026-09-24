import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { Database } from '../src/infrastructure/database/database.js';
import { accounts, diagramRevisions, diagrams, folders, memberships, operationReceipts, projects, resources, resourceVersions, users } from '../src/infrastructure/database/schema.js';
import { AccountService } from '../src/modules/account/account.service.js';
import { DiagramService } from '../src/modules/diagrams/diagram.service.js';
import { ImpactService } from '../src/modules/lifecycle/impact.service.js';
import { ProjectService } from '../src/modules/projects/project.service.js';
import { NoteService } from '../src/modules/resources/note.service.js';

describe.runIf(Boolean(process.env.DATABASE_URL))('diagramas con PostgreSQL', () => {
  const database = new Database(); const accountService = new AccountService(database); const projectService = new ProjectService(database); const notes = new NoteService(database); const service = new DiagramService(database); const impacts = new ImpactService(database); const clerkId = `diagram_owner_${crypto.randomUUID()}`; let userId = ''; let accountId = ''; let projectId = ''; let resourceId = '';
  afterAll(async () => { if (accountId) await database.db.delete(operationReceipts).where(eq(operationReceipts.accountId, accountId)); if (projectId) { const rows = await database.db.select({ id: diagrams.id }).from(diagrams).where(eq(diagrams.projectId, projectId)); for (const row of rows) await database.db.delete(diagramRevisions).where(eq(diagramRevisions.diagramId, row.id)); await database.db.delete(diagrams).where(eq(diagrams.projectId, projectId)); await database.db.delete(folders).where(eq(folders.projectId, projectId)); await database.db.delete(projects).where(eq(projects.id, projectId)); } if (resourceId) { await database.db.update(resources).set({ currentVersionId: null }).where(eq(resources.id, resourceId)); await database.db.delete(resourceVersions).where(eq(resourceVersions.resourceId, resourceId)); await database.db.delete(resources).where(eq(resources.id, resourceId)); } if (userId) { await database.db.delete(memberships).where(eq(memberships.userId, userId)); await database.db.delete(accounts).where(eq(accounts.personalOwnerUserId, userId)); await database.db.delete(users).where(eq(users.id, userId)); } await database.onModuleDestroy(); }, 30_000);
  it('crea vacío, renombra, duplica la composición y archiva con impacto', async () => {
    const identity = await accountService.ensureLocalUser({ clerkUserId: clerkId }); userId = identity.user.id; accountId = identity.account.id; const project = await projectService.create(accountId, 'Proyecto visual'); projectId = project.id;
    const note = await notes.create(accountId, userId, { title: 'Fuente', content: '' }); resourceId = note.id;
    const created = await service.create(accountId, projectId, 'Mapa'); expect(created.document.nodes).toEqual([]); const document = { schemaVersion: 1, nodes: [{ id: 'n1', position: { x: 0, y: 0 }, data: { resourceId } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
    const key = crypto.randomUUID(); const saved = await service.save(accountId, created.id, { document, expectedRevision: 0, idempotencyKey: key }); expect(saved.revision).toBe(1);
    const repeated = await service.save(accountId, created.id, { document, expectedRevision: 0, idempotencyKey: key }); expect(repeated.revision).toBe(1);
    const referenced = await impacts.get(accountId, 'resource', resourceId, 'delete'); expect(referenced.deletionAllowed).toBe(false); expect(referenced.locations).toContain('Proyecto visual / Mapa');
    await expect(service.save(accountId, created.id, { document: { ...document, nodes: [{ ...document.nodes[0], data: { resourceId: crypto.randomUUID() } }] }, expectedRevision: 1, idempotencyKey: crypto.randomUUID() })).rejects.toThrow('Recurso del Canvas no encontrado');
    const [folder] = await database.db.insert(folders).values({ projectId, name: 'Fuentes' }).returning();
    const folderDiagram = await service.create(accountId, projectId, 'Carpetas');
    const folderDocument = { ...document, nodes: [{ id: 'folder-1', type: 'folder', position: { x: 0, y: 0 }, data: { folderId: folder.id, projectId } }] };
    expect((await service.save(accountId, folderDiagram.id, { document: folderDocument, expectedRevision: 0, idempotencyKey: crypto.randomUUID() })).revision).toBe(1);
    await expect(service.save(accountId, folderDiagram.id, { document: { ...folderDocument, nodes: [{ ...folderDocument.nodes[0], data: { folderId: crypto.randomUUID(), projectId } }] }, expectedRevision: 1, idempotencyKey: crypto.randomUUID() })).rejects.toThrow('Carpeta del Canvas no encontrada');
    const [summary] = await service.list(accountId, projectId, 'active'); expect(summary).not.toHaveProperty('document');
    await expect(service.save(accountId, created.id, { document, expectedRevision: 0, idempotencyKey: crypto.randomUUID() })).rejects.toThrow('revisión remota cambió');
    expect((await database.db.select().from(diagramRevisions).where(eq(diagramRevisions.diagramId, created.id))).length).toBe(1);
    const renamed = await service.rename(accountId, created.id, 'Mapa principal'); expect(renamed.name).toBe('Mapa principal'); const copy = await service.duplicate(accountId, created.id); expect(copy.id).not.toBe(created.id); expect(copy.document).toEqual(document);
    const impact = await impacts.get(accountId, 'diagram', created.id, 'archive'); expect(impact.affected.resources).toBe(1); await impacts.execute(accountId, 'diagram', created.id, { action: 'archive', impactVersion: impact.impactVersion, confirmation: impact.confirmationPhrase, idempotencyKey: crypto.randomUUID() }); expect((await service.list(accountId, projectId, 'archived')).map(item => item.id)).toContain(created.id);
  }, 30_000);
});
