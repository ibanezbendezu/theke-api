import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { Database } from '../src/infrastructure/database/database.js';
import { accounts, libraryFolders, memberships, projectFolders, users } from '../src/infrastructure/database/schema.js';
import { AccountService } from '../src/modules/account/account.service.js';
import { ProjectFolderService } from '../src/modules/projects/project-folder.service.js';
import { LibraryFolderService } from '../src/modules/resources/library-folder.service.js';

describe.runIf(Boolean(process.env.DATABASE_URL))('carpetas anidadas de las colecciones', () => {
  const database = new Database();
  const accountService = new AccountService(database);
  const projectService = new ProjectFolderService(database);
  const libraryService = new LibraryFolderService(database);
  const clerkUserId = `collection_folders_${crypto.randomUUID()}`;

  afterAll(async () => {
    const [user] = await database.db.select({ id: users.id }).from(users).where(eq(users.clerkUserId, clerkUserId));
    if (user) {
      const [account] = await database.db.select({ id: accounts.id }).from(accounts).where(eq(accounts.personalOwnerUserId, user.id));
      if (account) {
        await database.db.delete(projectFolders).where(eq(projectFolders.accountId, account.id));
        await database.db.delete(libraryFolders).where(eq(libraryFolders.accountId, account.id));
        await database.db.delete(memberships).where(eq(memberships.accountId, account.id));
        await database.db.delete(accounts).where(eq(accounts.id, account.id));
      }
      await database.db.delete(users).where(eq(users.id, user.id));
    }
    await database.onModuleDestroy();
  });

  it('mantiene árboles independientes, permite nombres repetidos en ramas distintas y rechaza ciclos', async () => {
    const { account } = await accountService.ensureLocalUser({ clerkUserId });
    const projectRoot = await projectService.create(account.id, 'Raíz');
    const projectChild = await projectService.create(account.id, 'Hija', projectRoot.id);
    const projectOther = await projectService.create(account.id, 'Otra');
    const libraryRoot = await libraryService.create(account.id, 'Raíz');
    const libraryChild = await libraryService.create(account.id, 'Hija', libraryRoot.id);

    expect(projectChild.parentFolderId).toBe(projectRoot.id);
    expect(libraryChild.parentFolderId).toBe(libraryRoot.id);
    await expect(projectService.moveFolder(account.id, projectRoot.id, projectChild.id)).rejects.toThrow();
    await expect(libraryService.moveFolder(account.id, libraryRoot.id, libraryChild.id)).rejects.toThrow();
    expect((await projectService.moveFolder(account.id, projectChild.id, projectOther.id)).parentFolderId).toBe(projectOther.id);
    expect((await projectService.create(account.id, 'Hija', projectRoot.id)).parentFolderId).toBe(projectRoot.id);
    await expect(projectService.create(account.id, 'Hija', projectRoot.id)).rejects.toThrow();
    expect((await libraryService.list(account.id)).map(folder => folder.id)).not.toContain(projectRoot.id);
  }, 30_000);
});
