import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { Database } from '../../infrastructure/database/database.js';
import { diagrams, projects } from '../../infrastructure/database/schema.js';

const emptyDocument = () => ({ schemaVersion: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
function validName(value: unknown) { const name = typeof value === 'string' ? value.trim() : ''; if (!name || name.length > 120) throw new BadRequestException('El nombre debe tener entre 1 y 120 caracteres.'); return name; }

@Injectable()
export class DiagramService {
  constructor(@Inject(Database) private readonly database: Database) {}
  private async project(accountId: string, projectId: string) { const [project] = await this.database.db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.accountId, accountId), isNull(projects.deletedAt))).limit(1); if (!project) throw new NotFoundException('Proyecto no encontrado.'); return project; }
  async list(accountId: string, projectId: string, status: 'active' | 'archived') { await this.project(accountId, projectId); return this.database.db.select().from(diagrams).where(and(eq(diagrams.projectId, projectId), isNull(diagrams.deletedAt), status === 'archived' ? isNotNull(diagrams.archivedAt) : isNull(diagrams.archivedAt))).orderBy(desc(diagrams.updatedAt), desc(diagrams.id)); }
  async create(accountId: string, projectId: string, nameValue: unknown) { await this.project(accountId, projectId); const [diagram] = await this.database.db.insert(diagrams).values({ projectId, name: validName(nameValue), document: emptyDocument() }).returning(); return diagram!; }
  async get(accountId: string, id: string) { const [diagram] = await this.database.db.select({ id: diagrams.id, projectId: diagrams.projectId, name: diagrams.name, document: diagrams.document, archivedAt: diagrams.archivedAt, createdAt: diagrams.createdAt, updatedAt: diagrams.updatedAt }).from(diagrams).innerJoin(projects, and(eq(projects.id, diagrams.projectId), eq(projects.accountId, accountId), isNull(projects.deletedAt))).where(and(eq(diagrams.id, id), isNull(diagrams.deletedAt))).limit(1); if (!diagram) throw new NotFoundException('Diagrama no encontrado.'); return diagram; }
  async rename(accountId: string, id: string, nameValue: unknown) { await this.get(accountId, id); const [diagram] = await this.database.db.update(diagrams).set({ name: validName(nameValue), updatedAt: new Date() }).where(eq(diagrams.id, id)).returning(); return diagram!; }
  async duplicate(accountId: string, id: string, nameValue?: unknown) { const source = await this.get(accountId, id); const name = nameValue == null ? `${source.name} (copia)`.slice(0, 120) : validName(nameValue); const [copy] = await this.database.db.insert(diagrams).values({ projectId: source.projectId, name, document: source.document }).returning(); return copy!; }
  async restore(accountId: string, id: string) { await this.get(accountId, id); const [diagram] = await this.database.db.update(diagrams).set({ archivedAt: null, updatedAt: new Date() }).where(and(eq(diagrams.id, id), isNull(diagrams.deletedAt))).returning(); return diagram!; }
}
