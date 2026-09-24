import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { Database } from '../../infrastructure/database/database.js';
import { projects } from '../../infrastructure/database/schema.js';

const MAX_NAME_LENGTH = 120;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

export function normalizeProjectName(input: unknown): string {
  if (typeof input !== 'string') throw new BadRequestException('El nombre es obligatorio.');
  const name = input.trim();
  if (!name || name.length > MAX_NAME_LENGTH) throw new BadRequestException(`El nombre debe tener entre 1 y ${MAX_NAME_LENGTH} caracteres.`);
  return name;
}

function encodeCursor(project: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify([project.createdAt.toISOString(), project.id]), 'utf8').toString('base64url');
}

function decodeCursor(value?: string): [Date, string] | undefined {
  if (!value) return undefined;
  try {
    const [dateValue, id] = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown[];
    const date = new Date(String(dateValue));
    if (!id || Number.isNaN(date.getTime())) throw new Error();
    return [date, String(id)];
  } catch { throw new BadRequestException('El cursor no es válido.'); }
}

@Injectable()
export class ProjectService {
  constructor(@Inject(Database) private readonly database: Database) {}

  async list(accountId: string, status: 'active' | 'archived', cursorValue?: string, requestedLimit?: number) {
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.trunc(requestedLimit!), 1), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
    const cursor = decodeCursor(cursorValue);
    const visibility = status === 'archived' ? isNotNull(projects.archivedAt) : isNull(projects.archivedAt);
    const page = cursor
      ? or(lt(projects.createdAt, cursor[0]), and(eq(projects.createdAt, cursor[0]), lt(projects.id, cursor[1])))
      : undefined;
    const rows = await this.database.db.select().from(projects)
      .where(and(eq(projects.accountId, accountId), isNull(projects.deletedAt), visibility, page))
      .orderBy(desc(projects.createdAt), desc(projects.id)).limit(limit + 1);
    const hasMore = rows.length > limit;
    const data = rows.slice(0, limit);
    return { data, meta: { nextCursor: hasMore ? encodeCursor(data[data.length - 1]!) : null } };
  }

  async create(accountId: string, input: unknown) {
    const [project] = await this.database.db.insert(projects).values({ accountId, name: normalizeProjectName(input) }).returning();
    return project!;
  }

  async get(accountId: string, id: string) {
    const [project] = await this.database.db.select().from(projects).where(and(eq(projects.id, id), eq(projects.accountId, accountId), isNull(projects.deletedAt))).limit(1);
    if (!project) throw new NotFoundException('Proyecto no encontrado.');
    return project;
  }

  async rename(accountId: string, id: string, input: unknown) {
    const [project] = await this.database.db.update(projects).set({ name: normalizeProjectName(input), updatedAt: new Date() })
      .where(and(eq(projects.id, id), eq(projects.accountId, accountId), isNull(projects.deletedAt))).returning();
    if (!project) throw new NotFoundException('Proyecto no encontrado.');
    return project;
  }

  async setArchived(accountId: string, id: string, archived: boolean) {
    const [project] = await this.database.db.update(projects).set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
      .where(and(eq(projects.id, id), eq(projects.accountId, accountId), isNull(projects.deletedAt))).returning();
    if (!project) throw new NotFoundException('Proyecto no encontrado.');
    return project;
  }
}
