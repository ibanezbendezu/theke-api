import { createHash } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { Database } from '../../infrastructure/database/database.js';
import { resources, resourceVersions } from '../../infrastructure/database/schema.js';

export interface NoteInput { title?: unknown; description?: unknown; content?: unknown }
const hash = (content: string) => createHash('sha256').update(content).digest('hex');
function input(value: NoteInput) {
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  if (!title || title.length > 160) throw new BadRequestException('El título debe tener entre 1 y 160 caracteres.');
  if (value.description != null && typeof value.description !== 'string') throw new BadRequestException('La descripción no es válida.');
  if (typeof value.content !== 'string') throw new BadRequestException('El contenido es obligatorio.');
  return { title, description: value.description?.trim() || null, content: value.content };
}
function cursor(value?: string): [Date, string] | undefined {
  if (!value) return;
  try { const [date, id] = JSON.parse(Buffer.from(value, 'base64url').toString()) as [string, string]; return [new Date(date), id]; }
  catch { throw new BadRequestException('El cursor no es válido.'); }
}

@Injectable()
export class NoteService {
  constructor(@Inject(Database) private readonly database: Database) {}

  async list(accountId: string, cursorValue?: string) {
    const page = cursor(cursorValue);
    const condition = page ? or(lt(resources.updatedAt, page[0]), and(eq(resources.updatedAt, page[0]), lt(resources.id, page[1]))) : undefined;
    const rows = await this.database.db.select().from(resources).where(and(eq(resources.accountId, accountId), eq(resources.type, 'note'), condition)).orderBy(desc(resources.updatedAt), desc(resources.id)).limit(21);
    const data = rows.slice(0, 20);
    const last = data.at(-1);
    return { data, meta: { nextCursor: rows.length > 20 && last ? Buffer.from(JSON.stringify([last.updatedAt.toISOString(), last.id])).toString('base64url') : null } };
  }

  async create(accountId: string, authorUserId: string, value: NoteInput) {
    const note = input(value);
    return this.database.db.transaction(async tx => {
      const [resource] = await tx.insert(resources).values({ accountId, authorUserId, type: 'note', title: note.title, description: note.description, creationMethod: 'manual' }).returning();
      const [version] = await tx.insert(resourceVersions).values({ resourceId: resource!.id, authorUserId, ordinal: 1, content: note.content, contentHash: hash(note.content) }).returning();
      const [saved] = await tx.update(resources).set({ currentVersionId: version!.id }).where(eq(resources.id, resource!.id)).returning();
      return { ...saved!, currentVersion: version!, contentUnchanged: false };
    });
  }

  async get(accountId: string, id: string) {
    const [resource] = await this.database.db.select().from(resources).where(and(eq(resources.id, id), eq(resources.accountId, accountId), eq(resources.type, 'note'))).limit(1);
    if (!resource) throw new NotFoundException('Nota no encontrada.');
    const [version] = await this.database.db.select().from(resourceVersions).where(eq(resourceVersions.id, resource.currentVersionId!)).limit(1);
    return { ...resource, currentVersion: version! };
  }

  async update(accountId: string, authorUserId: string, id: string, value: NoteInput) {
    const note = input(value);
    return this.database.db.transaction(async tx => {
      const [resource] = await tx.select().from(resources).where(and(eq(resources.id, id), eq(resources.accountId, accountId), eq(resources.type, 'note'))).limit(1).for('update');
      if (!resource) throw new NotFoundException('Nota no encontrada.');
      const [current] = await tx.select().from(resourceVersions).where(eq(resourceVersions.id, resource.currentVersionId!)).limit(1);
      const contentUnchanged = current!.contentHash === hash(note.content);
      let version = current!;
      if (!contentUnchanged) {
        const [inserted] = await tx.insert(resourceVersions).values({ resourceId: id, authorUserId, ordinal: current!.ordinal + 1, content: note.content, contentHash: hash(note.content) }).returning();
        version = inserted!;
      }
      const [saved] = await tx.update(resources).set({ title: note.title, description: note.description, currentVersionId: version!.id, updatedAt: new Date() }).where(eq(resources.id, id)).returning();
      return { ...saved!, currentVersion: version!, contentUnchanged };
    });
  }
}
