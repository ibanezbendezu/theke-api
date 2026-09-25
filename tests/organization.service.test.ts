import { afterAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { Database } from '../src/infrastructure/database/database.js';
import { accounts, folders, memberships, projectResources, projects, resources, resourceVersions, users } from '../src/infrastructure/database/schema.js';
import { AccountService } from '../src/modules/account/account.service.js';
import { OrganizationService } from '../src/modules/projects/organization.service.js';
import { ProjectService } from '../src/modules/projects/project.service.js';
import { NoteService } from '../src/modules/resources/note.service.js';
import { ResourceKnowledgeRepository } from '../src/modules/resources/resource-knowledge.repository.js';

const integration = describe.runIf(Boolean(process.env.DATABASE_URL));
integration('organización de proyectos con PostgreSQL', () => {
  const database = new Database();
  const accountsService = new AccountService(database);
  const organization = new OrganizationService(database);
  const projectService = new ProjectService(database);
  const noteService = new NoteService(database, new ResourceKnowledgeRepository(database));
  const clerkIds = [`organization_owner_1_${crypto.randomUUID()}`, `organization_owner_2_${crypto.randomUUID()}`];

  afterAll(async () => {
    const createdUsers = await database.db.select({ id: users.id }).from(users).where(inArray(users.clerkUserId, clerkIds));
    const userIds = createdUsers.map(item => item.id);
    if (userIds.length) {
      const createdAccounts = await database.db.select({ id: accounts.id }).from(accounts).where(inArray(accounts.personalOwnerUserId, userIds));
      const accountIds = createdAccounts.map(item => item.id);
      if (accountIds.length) {
        const createdProjects = await database.db.select({ id: projects.id }).from(projects).where(inArray(projects.accountId, accountIds));
        const projectIds = createdProjects.map(item => item.id);
        const createdResources = await database.db.select({ id: resources.id }).from(resources).where(inArray(resources.accountId, accountIds));
        const resourceIds = createdResources.map(item => item.id);
        if (projectIds.length) {
          await database.db.delete(projectResources).where(inArray(projectResources.projectId, projectIds));
          await database.db.delete(folders).where(inArray(folders.projectId, projectIds));
          await database.db.delete(projects).where(inArray(projects.id, projectIds));
        }
        if (resourceIds.length) {
          await database.db.update(resources).set({ currentVersionId: null }).where(inArray(resources.id, resourceIds));
          await database.db.delete(resourceVersions).where(inArray(resourceVersions.resourceId, resourceIds));
          await database.db.delete(resources).where(inArray(resources.id, resourceIds));
        }
      }
      await database.db.delete(memberships).where(inArray(memberships.userId, userIds));
      await database.db.delete(accounts).where(inArray(accounts.personalOwnerUserId, userIds));
      await database.db.delete(users).where(inArray(users.id, userIds));
    }
    await database.onModuleDestroy();
  });

  it('crea carpetas, reutiliza referencias y aísla las cuentas', async () => {
    const owner = await accountsService.ensureLocalUser({ clerkUserId: clerkIds[0]! });
    const outsider = await accountsService.ensureLocalUser({ clerkUserId: clerkIds[1]! });
    const project = await projectService.create(owner.account.id, 'Investigación');
    const note = await noteService.create(owner.account.id, owner.user.id, { title: 'Fuente', content: 'Contenido' });
    const otherNote = await noteService.create(outsider.account.id, outsider.user.id, { title: 'Ajena', content: 'Contenido' });
    const folder = await organization.createFolder(owner.account.id, project.id, 'Fuentes');

    expect(await organization.addResources(owner.account.id, project.id, [note.id], folder.id)).toHaveLength(1);
    expect(await organization.addResources(owner.account.id, project.id, [note.id], folder.id)).toHaveLength(1);
    expect((await organization.moveResources(owner.account.id, project.id, [note.id], null))[0]?.folderId).toBeNull();
    expect((await organization.archiveFolder(owner.account.id, project.id, folder.id, true)).archivedAt).not.toBeNull();
    expect((await organization.archiveFolder(owner.account.id, project.id, folder.id, false)).archivedAt).toBeNull();
    expect((await organization.list(owner.account.id, project.id)).resources).toHaveLength(1);
    await expect(organization.list(outsider.account.id, project.id)).rejects.toThrow('Proyecto no encontrado');
    await expect(organization.addResources(owner.account.id, project.id, [otherNote.id])).rejects.toThrow('Recurso no encontrado');
  }, 30_000);
});
