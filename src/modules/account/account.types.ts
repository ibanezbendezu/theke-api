export interface ExternalIdentity { clerkUserId: string; email?: string | null; displayName?: string | null }
export interface LocalIdentity {
  user: { id: string; email: string | null; displayName: string | null };
  account: { id: string; name: string };
  membership: { id: string; role: 'owner' | 'member' };
}
