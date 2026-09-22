import { describe, expect, it } from 'vitest';
import { AccountService } from '../src/modules/account/account.service.js';
import { users, accounts, memberships } from '../src/infrastructure/database/schema.js';

function fakeDatabase() {
  const state = { users: new Map<string, any>(), accounts: new Map<string, any>(), memberships: new Map<string, any>() };
  const tx = {
    insert(table: unknown) { return { values(value: any) { const apply = () => {
      if (table === users) { const found = state.users.get(value.clerkUserId); state.users.set(value.clerkUserId, { id: found?.id ?? crypto.randomUUID(), ...found, ...value }); }
      if (table === accounts && !state.accounts.has(value.personalOwnerUserId)) state.accounts.set(value.personalOwnerUserId, { id: crypto.randomUUID(), ...value });
      if (table === memberships) { const key = `${value.accountId}:${value.userId}`; if (!state.memberships.has(key)) state.memberships.set(key, { id: crypto.randomUUID(), ...value }); }
    }; return { onConflictDoUpdate: async () => apply(), onConflictDoNothing: async () => apply() }; }}; },
    select() { return { from(table: unknown) { return { where() { return { limit: async () => table === users ? [...state.users.values()].slice(-1) : table === accounts ? [...state.accounts.values()].slice(-1) : [...state.memberships.values()].slice(-1) }; }}; }}; },
  };
  return { database: { db: { transaction: (fn: any) => fn(tx) } } as any, state };
}

describe('ensureLocalUser', () => {
  it('aprovisiona idempotentemente una sola terna incluso con requests concurrentes', async () => {
    const fake = fakeDatabase(); const service = new AccountService(fake.database);
    const identity = { clerkUserId: 'user_1', email: 'daniel@example.test', displayName: 'Daniel' };
    const [first, second] = await Promise.all([service.ensureLocalUser(identity), service.ensureLocalUser(identity)]);
    expect(second).toEqual(first); expect(fake.state.users.size).toBe(1); expect(fake.state.accounts.size).toBe(1); expect(fake.state.memberships.size).toBe(1);
  });
  it('aísla cuentas distintas y nunca recibe accountId del cliente', async () => {
    const fake = fakeDatabase(); const service = new AccountService(fake.database);
    const one = await service.ensureLocalUser({ clerkUserId: 'user_1' }); const two = await service.ensureLocalUser({ clerkUserId: 'user_2' });
    expect(one.account.id).not.toBe(two.account.id); expect(service.ensureLocalUser.length).toBe(1);
  });
});
