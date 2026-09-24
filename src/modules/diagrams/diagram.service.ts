import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { Database } from '../../infrastructure/database/database.js';
import { diagramRevisions, diagrams, projects, resources } from '../../infrastructure/database/schema.js';

const emptyDocument = () => ({ schemaVersion: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
function validName(value: unknown) { const name = typeof value === 'string' ? value.trim() : ''; if (!name || name.length > 120) throw new BadRequestException('El nombre debe tener entre 1 y 120 caracteres.'); return name; }
type Document = typeof diagrams.$inferSelect.document;
function validDocument(value: unknown): Document {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Documento de Canvas inválido.');
  const document = value as Partial<Document>;
  if (document.schemaVersion !== 1 || !Array.isArray(document.nodes) || !Array.isArray(document.edges) || !document.viewport ||
    ![document.viewport.x, document.viewport.y, document.viewport.zoom].every(item => typeof item === 'number' && Number.isFinite(item)) || document.viewport.zoom <= 0 ||
    document.nodes.some(item => !item || typeof item !== 'object' || typeof (item as { id?: unknown }).id !== 'string' || !(item as { id: string }).id || !(item as { position?: unknown }).position || !(item as { data?: unknown }).data) ||
    document.edges.some(item => !item || typeof item !== 'object' || !['id', 'source', 'target'].every(key => typeof (item as Record<string, unknown>)[key] === 'string')) ||
    JSON.stringify(value).length > 5_000_000) throw new BadRequestException('Documento de Canvas inválido o demasiado grande.');
  return document as Document;
}

@Injectable()
export class DiagramService {
  constructor(@Inject(Database) private readonly database: Database) {}
  private async project(accountId: string, projectId: string) { const [project] = await this.database.db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.accountId, accountId), isNull(projects.deletedAt))).limit(1); if (!project) throw new NotFoundException('Proyecto no encontrado.'); return project; }
  async list(accountId: string, projectId: string, status: 'active' | 'archived') { await this.project(accountId, projectId); return this.database.db.select({ id: diagrams.id, projectId: diagrams.projectId, name: diagrams.name, revision: diagrams.revision, archivedAt: diagrams.archivedAt, createdAt: diagrams.createdAt, updatedAt: diagrams.updatedAt }).from(diagrams).where(and(eq(diagrams.projectId, projectId), isNull(diagrams.deletedAt), status === 'archived' ? isNotNull(diagrams.archivedAt) : isNull(diagrams.archivedAt))).orderBy(desc(diagrams.updatedAt), desc(diagrams.id)); }
  async create(accountId: string, projectId: string, nameValue: unknown) { await this.project(accountId, projectId); const [diagram] = await this.database.db.insert(diagrams).values({ projectId, name: validName(nameValue), document: emptyDocument() }).returning(); return diagram!; }
  async get(accountId: string, id: string) { const [diagram] = await this.database.db.select({ id: diagrams.id, projectId: diagrams.projectId, name: diagrams.name, document: diagrams.document, revision: diagrams.revision, archivedAt: diagrams.archivedAt, createdAt: diagrams.createdAt, updatedAt: diagrams.updatedAt }).from(diagrams).innerJoin(projects, and(eq(projects.id, diagrams.projectId), eq(projects.accountId, accountId), isNull(projects.deletedAt))).where(and(eq(diagrams.id, id), isNull(diagrams.deletedAt))).limit(1); if (!diagram) throw new NotFoundException('Diagrama no encontrado.'); return diagram; }
  async save(accountId: string, id: string, input: { document?: unknown; expectedRevision?: unknown; idempotencyKey?: unknown }) {
    const document = validDocument(input.document);
    if (!Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number) < 0) throw new BadRequestException('Revisión esperada inválida.');
    if (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim() || input.idempotencyKey.length > 120) throw new BadRequestException('Falta la clave de idempotencia.');
    return this.database.db.transaction(async tx => {
      const [current] = await tx.select({ revision: diagrams.revision, archivedAt: diagrams.archivedAt }).from(diagrams).innerJoin(projects, and(eq(projects.id, diagrams.projectId), eq(projects.accountId, accountId), isNull(projects.deletedAt))).where(and(eq(diagrams.id, id), isNull(diagrams.deletedAt))).for('update').limit(1);
      if (!current) throw new NotFoundException('Diagrama no encontrado.');
      const [prior] = await tx.select({ revision: diagramRevisions.revision, document: diagramRevisions.document, createdAt: diagramRevisions.createdAt }).from(diagramRevisions).where(and(eq(diagramRevisions.diagramId, id), eq(diagramRevisions.idempotencyKey, input.idempotencyKey as string))).limit(1);
      if (prior) { if (!isDeepStrictEqual(prior.document, document)) throw new ConflictException('La clave de idempotencia ya se usó para otro documento.'); return { revision: prior.revision, document: prior.document, updatedAt: prior.createdAt }; }
      if (current.archivedAt) throw new ConflictException('El diagrama está archivado.');
      if (current.revision !== input.expectedRevision) throw new ConflictException({ message: 'La revisión remota cambió.', details: { currentRevision: current.revision } });
      const resourceIds = [...new Set(document.nodes.map(node => (node as { data?: { resourceId?: unknown } }).data?.resourceId).filter((value): value is string => typeof value === 'string'))];
      if (resourceIds.some(value => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))) throw new BadRequestException('Referencia de recurso inválida.');
      if (resourceIds.length) { const owned = await tx.select({ id: resources.id }).from(resources).where(and(eq(resources.accountId, accountId), isNull(resources.deletedAt), inArray(resources.id, resourceIds))).for('share'); if (owned.length !== resourceIds.length) throw new NotFoundException('Recurso del Canvas no encontrado.'); }
      const revision = current.revision + 1; const updatedAt = new Date();
      await tx.update(diagrams).set({ document, revision, updatedAt }).where(eq(diagrams.id, id));
      await tx.insert(diagramRevisions).values({ diagramId: id, revision, idempotencyKey: input.idempotencyKey as string, document, createdAt: updatedAt });
      return { revision, document, updatedAt };
    }, { isolationLevel: 'serializable' });
  }
  async rename(accountId: string, id: string, nameValue: unknown) { await this.get(accountId, id); const [diagram] = await this.database.db.update(diagrams).set({ name: validName(nameValue), updatedAt: new Date() }).where(eq(diagrams.id, id)).returning(); return diagram!; }
  async duplicate(accountId: string, id: string, nameValue?: unknown) { const source = await this.get(accountId, id); const name = nameValue == null ? `${source.name} (copia)`.slice(0, 120) : validName(nameValue); const [copy] = await this.database.db.insert(diagrams).values({ projectId: source.projectId, name, document: source.document }).returning(); return copy!; }
  async restore(accountId: string, id: string) { await this.get(accountId, id); const [diagram] = await this.database.db.update(diagrams).set({ archivedAt: null, updatedAt: new Date() }).where(and(eq(diagrams.id, id), isNull(diagrams.deletedAt))).returning(); return diagram!; }
}
