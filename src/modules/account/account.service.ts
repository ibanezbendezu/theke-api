import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { Database } from '../../infrastructure/database/database.js';
import { accounts, memberships, users } from '../../infrastructure/database/schema.js';
import type { ExternalIdentity, LocalIdentity } from './account.types.js';

@Injectable()
export class AccountService {
  constructor(private readonly database: Database) {}

  async ensureLocalUser(identity: ExternalIdentity): Promise<LocalIdentity> {
    return this.database.db.transaction(async (tx) => {
      await tx.insert(users).values({ clerkUserId: identity.clerkUserId, email: identity.email ?? null, displayName: identity.displayName ?? null }).onConflictDoUpdate({ target: users.clerkUserId, set: { email: identity.email ?? null, displayName: identity.displayName ?? null } });
      const [user] = await tx.select().from(users).where(eq(users.clerkUserId, identity.clerkUserId)).limit(1);
      if (!user) throw new Error('No se pudo aprovisionar el usuario');
      await tx.insert(accounts).values({ personalOwnerUserId: user.id, name: identity.displayName ? `Espacio de ${identity.displayName}` : 'Mi espacio Theke' }).onConflictDoNothing({ target: accounts.personalOwnerUserId });
      const [account] = await tx.select().from(accounts).where(eq(accounts.personalOwnerUserId, user.id)).limit(1);
      if (!account) throw new Error('No se pudo aprovisionar la cuenta');
      await tx.insert(memberships).values({ accountId: account.id, userId: user.id, role: 'owner' }).onConflictDoNothing({ target: [memberships.accountId, memberships.userId] });
      const [membership] = await tx.select().from(memberships).where(and(eq(memberships.accountId, account.id), eq(memberships.userId, user.id))).limit(1);
      if (!membership) throw new Error('No se pudo aprovisionar la membresía');
      return { user: { id: user.id, email: user.email, displayName: user.displayName }, account: { id: account.id, name: account.name }, membership: { id: membership.id, role: membership.role } };
    });
  }
}
