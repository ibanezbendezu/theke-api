import { afterAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { AccountService } from '../src/modules/account/account.service.js';
import { Database } from '../src/infrastructure/database/database.js';
import { accounts, memberships, users } from '../src/infrastructure/database/schema.js';

const integration = describe.runIf(Boolean(process.env.DATABASE_URL));

integration('ensureLocalUser con PostgreSQL', () => {
  const database = new Database();
  const service = new AccountService(database);
  const suffix = crypto.randomUUID();
  const firstClerkUserId = `integration_owner_1_${suffix}`;
  const secondClerkUserId = `integration_owner_2_${suffix}`;
  const clerkUserIds = [firstClerkUserId, secondClerkUserId];

  afterAll(async () => {
    const createdUsers = await database.db.select({ id: users.id }).from(users).where(inArray(users.clerkUserId, clerkUserIds));
    const userIds = createdUsers.map((user) => user.id);
    if (userIds.length > 0) {
      await database.db.delete(memberships).where(inArray(memberships.userId, userIds));
      await database.db.delete(accounts).where(inArray(accounts.personalOwnerUserId, userIds));
      await database.db.delete(users).where(inArray(users.id, userIds));
    }
    await database.onModuleDestroy();
  });

  it('crea una sola terna concurrente, conserva metadata y aísla dos propietarios', async () => {
    const [first, duplicate] = await Promise.all([
      service.ensureLocalUser({ clerkUserId: firstClerkUserId }),
      service.ensureLocalUser({ clerkUserId: firstClerkUserId }),
    ]);
    expect(duplicate).toEqual(first);
    const [ownerOneUser] = await database.db.select().from(users).where(inArray(users.clerkUserId, [firstClerkUserId]));
    if (!ownerOneUser) throw new Error('No se aprovisionó el primer usuario');
    const ownerOneAccounts = await database.db.select().from(accounts).where(inArray(accounts.personalOwnerUserId, [ownerOneUser.id]));
    const ownerOneMemberships = await database.db.select().from(memberships).where(inArray(memberships.userId, [ownerOneUser.id]));
    expect(ownerOneAccounts).toHaveLength(1);
    expect(ownerOneMemberships).toHaveLength(1);

    const enriched = await service.ensureLocalUser({ clerkUserId: firstClerkUserId, email: 'owner-1@example.test', displayName: 'Owner One' });
    const restored = await service.ensureLocalUser({ clerkUserId: firstClerkUserId });
    expect(restored.user).toMatchObject({ email: 'owner-1@example.test', displayName: 'Owner One' });
    expect(enriched.account.name).toBe('Espacio de Owner One');

    const second = await service.ensureLocalUser({ clerkUserId: secondClerkUserId, email: 'owner-2@example.test', displayName: 'Owner Two' });
    expect(second.user.id).not.toBe(first.user.id);
    expect(second.account.id).not.toBe(first.account.id);

    const createdUsers = await database.db.select().from(users).where(inArray(users.clerkUserId, clerkUserIds));
    const userIds = createdUsers.map((user) => user.id);
    const createdAccounts = await database.db.select().from(accounts).where(inArray(accounts.personalOwnerUserId, userIds));
    const createdMemberships = await database.db.select().from(memberships).where(inArray(memberships.userId, userIds));
    expect(createdUsers).toHaveLength(2);
    expect(createdAccounts).toHaveLength(2);
    expect(createdMemberships).toHaveLength(2);
    expect(new Set(createdMemberships.map((membership) => membership.accountId)).size).toBe(2);
  });
});
