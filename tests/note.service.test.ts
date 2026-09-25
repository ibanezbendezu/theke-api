import { afterAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { Database } from '../src/infrastructure/database/database.js';
import { accounts, memberships, resources, resourceVersions, users } from '../src/infrastructure/database/schema.js';
import { AccountService } from '../src/modules/account/account.service.js';
import { NoteService } from '../src/modules/resources/note.service.js';
import { ResourceKnowledgeRepository } from '../src/modules/resources/resource-knowledge.repository.js';

const integration = describe.runIf(Boolean(process.env.DATABASE_URL));
integration('notes con PostgreSQL', () => {
  const database = new Database(); const accountsService = new AccountService(database); const notes = new NoteService(database, new ResourceKnowledgeRepository(database));
  const clerkIds = [`note_owner_1_${crypto.randomUUID()}`, `note_owner_2_${crypto.randomUUID()}`];
  afterAll(async () => {
    const created = await database.db.select({ id: users.id }).from(users).where(inArray(users.clerkUserId, clerkIds)); const userIds = created.map(item => item.id);
    if (userIds.length) { const owned = await database.db.select({ id: accounts.id }).from(accounts).where(inArray(accounts.personalOwnerUserId, userIds)); const accountIds = owned.map(item => item.id); const notesCreated = accountIds.length ? await database.db.select({ id: resources.id }).from(resources).where(inArray(resources.accountId, accountIds)) : []; const resourceIds = notesCreated.map(item => item.id); if (resourceIds.length) { await database.db.update(resources).set({ currentVersionId: null }).where(inArray(resources.id, resourceIds)); await database.db.delete(resourceVersions).where(inArray(resourceVersions.resourceId, resourceIds)); await database.db.delete(resources).where(inArray(resources.id, resourceIds)); } await database.db.delete(memberships).where(inArray(memberships.userId, userIds)); await database.db.delete(accounts).where(inArray(accounts.personalOwnerUserId, userIds)); await database.db.delete(users).where(inArray(users.id, userIds)); }
    await database.onModuleDestroy();
  });
  it('versiona cambios, evita redundancia y aísla cuentas', async () => {
    const first = await accountsService.ensureLocalUser({ clerkUserId: clerkIds[0]! }); const second = await accountsService.ensureLocalUser({ clerkUserId: clerkIds[1]! });
    const created = await notes.create(first.account.id, first.user.id, { title: 'Nota', description: '', content: 'v1' });
    const unchanged = await notes.update(first.account.id, first.user.id, created.id, { title: 'Nota editada', description: '', content: 'v1' }); expect(unchanged.contentUnchanged).toBe(true); expect(unchanged.currentVersion.ordinal).toBe(1);
    const changed = await notes.update(first.account.id, first.user.id, created.id, { title: 'Nota editada', description: '', content: 'v2' }); expect(changed.currentVersion.ordinal).toBe(2);
    await expect(notes.get(second.account.id, created.id)).rejects.toThrow('Nota no encontrada');
  }, 30_000);
});
