import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { Database } from '../../infrastructure/database/database.js';
import { resourceAccessibility, resources, resourceVersions } from '../../infrastructure/database/schema.js';

@Injectable()
export class ResourceRepository {
  constructor(@Inject(Database) private readonly database: Database) {}
  private selection = { id: resources.id, title: resources.title, description: resources.description, type: resources.type, creationMethod: resources.creationMethod, updatedAt: resources.updatedAt, versionId: resourceVersions.id, content: resourceVersions.content, storageKey: resourceVersions.storageKey, mediaType: resourceVersions.mediaType, byteSize: resourceVersions.byteSize, accessibilityText: resourceAccessibility.text };
  async list(accountId: string, type: 'note' | 'file' | undefined, cursor?: [Date, string]) { const page = cursor ? or(lt(resources.updatedAt, cursor[0]), and(eq(resources.updatedAt, cursor[0]), lt(resources.id, cursor[1]))) : undefined; return this.database.db.select(this.selection).from(resources).innerJoin(resourceVersions, eq(resourceVersions.id, resources.currentVersionId)).leftJoin(resourceAccessibility, eq(resourceAccessibility.resourceId, resources.id)).where(and(eq(resources.accountId, accountId), type ? eq(resources.type, type) : undefined, page)).orderBy(desc(resources.updatedAt), desc(resources.id)).limit(21); }
  async get(accountId: string, id: string) { const [value] = await this.database.db.select(this.selection).from(resources).innerJoin(resourceVersions, eq(resourceVersions.id, resources.currentVersionId)).leftJoin(resourceAccessibility, eq(resourceAccessibility.resourceId, resources.id)).where(and(eq(resources.accountId, accountId), eq(resources.id, id))).limit(1); return value; }
  async setAccessibility(accountId: string, id: string, text: string) { const resource = await this.get(accountId, id); if (!resource) return; await this.database.db.insert(resourceAccessibility).values({ resourceId: id, text }).onConflictDoUpdate({ target: resourceAccessibility.resourceId, set: { text, updatedAt: new Date() } }); return this.get(accountId, id); }
}
