import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { Database } from '../src/infrastructure/database/database.js';
import { accounts, diagrams, memberships, operationReceipts, projects, users } from '../src/infrastructure/database/schema.js';
import { AccountService } from '../src/modules/account/account.service.js';
import { DiagramService } from '../src/modules/diagrams/diagram.service.js';
import { ImpactService } from '../src/modules/lifecycle/impact.service.js';
import { ProjectService } from '../src/modules/projects/project.service.js';

describe.runIf(Boolean(process.env.DATABASE_URL))('diagramas con PostgreSQL', () => {
  const database = new Database(); const accountService = new AccountService(database); const projectService = new ProjectService(database); const service = new DiagramService(database); const impacts = new ImpactService(database); const clerkId = `diagram_owner_${crypto.randomUUID()}`; let userId = ''; let accountId = ''; let projectId = '';
  afterAll(async () => { if (accountId) await database.db.delete(operationReceipts).where(eq(operationReceipts.accountId, accountId)); if (projectId) { await database.db.delete(diagrams).where(eq(diagrams.projectId, projectId)); await database.db.delete(projects).where(eq(projects.id, projectId)); } if (userId) { await database.db.delete(memberships).where(eq(memberships.userId, userId)); await database.db.delete(accounts).where(eq(accounts.personalOwnerUserId, userId)); await database.db.delete(users).where(eq(users.id, userId)); } await database.onModuleDestroy(); }, 30_000);
  it('crea vacío, renombra, duplica la composición y archiva con impacto', async () => {
    const identity = await accountService.ensureLocalUser({ clerkUserId: clerkId }); userId = identity.user.id; accountId = identity.account.id; const project = await projectService.create(accountId, 'Proyecto visual'); projectId = project.id;
    const created = await service.create(accountId, projectId, 'Mapa'); expect(created.document.nodes).toEqual([]); const document = { schemaVersion: 1, nodes: [{ id: 'n1', position: { x: 0, y: 0 }, data: { resourceId: crypto.randomUUID() } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }; await database.db.update(diagrams).set({ document }).where(eq(diagrams.id, created.id));
    const renamed = await service.rename(accountId, created.id, 'Mapa principal'); expect(renamed.name).toBe('Mapa principal'); const copy = await service.duplicate(accountId, created.id); expect(copy.id).not.toBe(created.id); expect(copy.document).toEqual(document);
    const impact = await impacts.get(accountId, 'diagram', created.id, 'archive'); expect(impact.affected.resources).toBe(1); await impacts.execute(accountId, 'diagram', created.id, { action: 'archive', impactVersion: impact.impactVersion, confirmation: impact.confirmationPhrase, idempotencyKey: crypto.randomUUID() }); expect((await service.list(accountId, projectId, 'archived')).map(item => item.id)).toContain(created.id);
  }, 30_000);
});
