import { afterAll, describe, expect, it, vi } from 'vitest';
import { inArray } from 'drizzle-orm';
import { Database } from '../src/infrastructure/database/database.js';
import { accounts, memberships, resourceAccessibility, resources, resourceVersions, users } from '../src/infrastructure/database/schema.js';
import { AccountService } from '../src/modules/account/account.service.js';
import { ResourceRepository } from '../src/modules/resources/resource.repository.js';
import { ResourceService } from '../src/modules/resources/resource.service.js';
import { NoteService } from '../src/modules/resources/note.service.js';
import type { UploadStorage } from '../src/modules/uploads/upload.ports.js';

const integration = describe.runIf(Boolean(process.env.DATABASE_URL));
integration('consulta de recursos con PostgreSQL', () => {
  const database = new Database(); const accountsService = new AccountService(database); const notes = new NoteService(database); const repository = new ResourceRepository(database);
  const storage: UploadStorage = { presignGet: vi.fn(async () => 'https://storage.test/signed'), presignPut: vi.fn(), head: vi.fn(), copy: vi.fn(), read: vi.fn(), remove: vi.fn() };
  const service = new ResourceService(repository, storage); const clerkIds = [`resource_owner_1_${crypto.randomUUID()}`, `resource_owner_2_${crypto.randomUUID()}`];
  afterAll(async () => { const createdUsers = await database.db.select({ id: users.id }).from(users).where(inArray(users.clerkUserId, clerkIds)); const userIds = createdUsers.map(value => value.id); if (userIds.length) { const createdAccounts = await database.db.select({ id: accounts.id }).from(accounts).where(inArray(accounts.personalOwnerUserId, userIds)); const accountIds = createdAccounts.map(value => value.id); if (accountIds.length) { const owned = await database.db.select({ id: resources.id }).from(resources).where(inArray(resources.accountId, accountIds)); const ids = owned.map(value => value.id); if (ids.length) { await database.db.delete(resourceAccessibility).where(inArray(resourceAccessibility.resourceId, ids)); await database.db.update(resources).set({ currentVersionId: null }).where(inArray(resources.id, ids)); await database.db.delete(resourceVersions).where(inArray(resourceVersions.resourceId, ids)); await database.db.delete(resources).where(inArray(resources.id, ids)); } } await database.db.delete(memberships).where(inArray(memberships.userId, userIds)); await database.db.delete(accounts).where(inArray(accounts.personalOwnerUserId, userIds)); await database.db.delete(users).where(inArray(users.id, userIds)); } await database.onModuleDestroy(); }, 30_000);
  it('lista por tipo, entrega acceso privado y aísla cuentas', async () => {
    const owner = await accountsService.ensureLocalUser({ clerkUserId: clerkIds[0]! }); const outsider = await accountsService.ensureLocalUser({ clerkUserId: clerkIds[1]! }); await notes.create(owner.account.id, owner.user.id, { title: 'Nota', content: 'Contenido' });
    const [file] = await database.db.insert(resources).values({ accountId: owner.account.id, authorUserId: owner.user.id, type: 'file', title: 'imagen.png', creationMethod: 'manual' }).returning(); const [version] = await database.db.insert(resourceVersions).values({ resourceId: file!.id, authorUserId: owner.user.id, ordinal: 1, content: '', contentHash: 'abc', storageKey: 'clean/image', mediaType: 'image/png', byteSize: 1024 }).returning(); await database.db.update(resources).set({ currentVersionId: version!.id }).where(inArray(resources.id, [file!.id]));
    expect((await service.list(owner.account.id)).data).toHaveLength(2); expect((await service.list(owner.account.id, 'file')).data).toHaveLength(1); const detail = await service.get(owner.account.id, file!.id); expect(detail.accessibilityMissing).toBe(true); expect((await service.access(owner.account.id, file!.id, 'download')).url).toContain('signed'); expect((await service.setAccessibility(owner.account.id, file!.id, 'Descripción')).accessibilityMissing).toBe(false); await expect(service.get(outsider.account.id, file!.id)).rejects.toThrow('Recurso no encontrado');
  }, 30_000);
});
