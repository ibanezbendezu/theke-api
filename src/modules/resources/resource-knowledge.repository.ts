import { Inject, Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { Database } from '../../infrastructure/database/database.js';
import { accounts, resourceMentions, resourcePropertyDefinitions, resources } from '../../infrastructure/database/schema.js';
import { normalizeKnowledgeName, parseMentions } from './knowledge-links.js';

type PropertyType = typeof resourcePropertyDefinitions.$inferSelect.type;
type Metadata = { aliases: string[]; tags: string[]; properties: Record<string, string | number | boolean | string[]>; types: Record<string, PropertyType> };

@Injectable()
export class ResourceKnowledgeRepository {
  constructor(@Inject(Database) private readonly database: Database) {}

  definitions(accountId: string) { return this.database.db.select({ key: resourcePropertyDefinitions.key, type: resourcePropertyDefinitions.type }).from(resourcePropertyDefinitions).where(eq(resourcePropertyDefinitions.accountId, accountId)); }

  async saveMetadata(accountId: string, id: string, expectedUpdatedAt: Date, metadata: Metadata) {
    return this.database.db.transaction(async tx => {
      await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId)).for('update');
      const [resource] = await tx.select({ updatedAt: resources.updatedAt }).from(resources).where(and(eq(resources.id, id), eq(resources.accountId, accountId), isNull(resources.deletedAt))).for('update').limit(1);
      if (!resource) throw new NotFoundException('Recurso no encontrado.');
      if (resource.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new ConflictException('El Recurso cambió. Recarga sus propiedades antes de guardar.');
      const definitions = await tx.select({ key: resourcePropertyDefinitions.key, type: resourcePropertyDefinitions.type }).from(resourcePropertyDefinitions).where(eq(resourcePropertyDefinitions.accountId, accountId));
      const existing = new Map(definitions.map(item => [item.key, item.type]));
      for (const [key, type] of Object.entries(metadata.types)) {
        const prior = existing.get(key);
        if (prior && prior !== type) throw new ConflictException(`La propiedad ${key} ya tiene tipo ${prior} en esta Cuenta.`);
        if (!prior) await tx.insert(resourcePropertyDefinitions).values({ accountId, key, type });
      }
      const [updated] = await tx.update(resources).set({ aliases: metadata.aliases, tags: metadata.tags, properties: metadata.properties, updatedAt: new Date() }).where(eq(resources.id, id)).returning();
      return updated!;
    });
  }

  async references(accountId: string, id: string) {
    const [resource] = await this.database.db.select({ id: resources.id, versionId: resources.currentVersionId }).from(resources).where(and(eq(resources.id, id), eq(resources.accountId, accountId), isNull(resources.deletedAt))).limit(1);
    if (!resource) throw new NotFoundException('Recurso no encontrado.');
    const outgoing = resource.versionId ? await this.database.db.select({ mention: resourceMentions, targetTitle: resources.title }).from(resourceMentions).leftJoin(resources, eq(resources.id, resourceMentions.targetResourceId)).where(eq(resourceMentions.sourceVersionId, resource.versionId)) : [];
    const incoming = await this.database.db.select({ mention: resourceMentions, sourceTitle: resources.title, sourceVersionId: resources.currentVersionId }).from(resourceMentions).innerJoin(resources, and(eq(resources.id, resourceMentions.sourceResourceId), eq(resources.accountId, accountId), isNull(resources.deletedAt))).where(eq(resourceMentions.targetResourceId, id));
    return { outgoing: outgoing.map(item => ({ ...item.mention, targetTitle: item.targetTitle })), incoming: incoming.filter(item => item.mention.sourceVersionId === item.sourceVersionId).map(item => ({ ...item.mention, sourceTitle: item.sourceTitle })) };
  }

  async indexNoteMentions(tx: Parameters<Parameters<Database['db']['transaction']>[0]>[0], accountId: string, sourceResourceId: string, sourceVersionId: string, content: string, previousVersionId?: string) {
    const parsed = parseMentions(content);
    if (!parsed.length) return;
    const candidates = await tx.select({ id: resources.id, title: resources.title, aliases: resources.aliases }).from(resources).where(and(eq(resources.accountId, accountId), isNull(resources.deletedAt)));
    const byId = new Set(candidates.map(item => item.id));
    const byName = new Map<string, Set<string>>();
    for (const candidate of candidates) for (const name of [candidate.title, ...candidate.aliases]) { const key = normalizeKnowledgeName(name); const values = byName.get(key) ?? new Set<string>(); values.add(candidate.id); byName.set(key, values); }
    const previous = previousVersionId ? await tx.select({ rawTarget: resourceMentions.rawTarget, targetResourceId: resourceMentions.targetResourceId }).from(resourceMentions).where(eq(resourceMentions.sourceVersionId, previousVersionId)) : [];
    const priorByName = new Map(previous.filter(item => item.targetResourceId).map(item => [normalizeKnowledgeName(item.rawTarget), item.targetResourceId!]));
    const uuid = /^resource:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
    await tx.insert(resourceMentions).values(parsed.map(item => {
      const explicit = item.rawTarget.match(uuid)?.[1]?.toLowerCase();
      const name = normalizeKnowledgeName(item.rawTarget);
      const matches = byName.get(name) ?? new Set<string>();
      const prior = priorByName.get(name);
      const targetResourceId = explicit ? byId.has(explicit) ? explicit : null : prior && byId.has(prior) ? prior : matches.size === 1 ? [...matches][0]! : null;
      return { sourceResourceId, sourceVersionId, targetResourceId, rawTarget: item.rawTarget, displayText: item.displayText, anchor: item.anchor, startOffset: item.startOffset, endOffset: item.endOffset, resolution: targetResourceId ? 'linked' as const : matches.size > 1 ? 'ambiguous' as const : 'unresolved' as const };
    }));
  }
}
