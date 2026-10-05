import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { Database } from '../../infrastructure/database/database.js';
import { withSerializationRetry } from '../../infrastructure/database/serialization-retry.js';
import { diagramRevisions, diagrams, folders, projectResources, projects, relationEvidence, relations, resources } from '../../infrastructure/database/schema.js';

const emptyDocument = () => ({ schemaVersion: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, background: { variant: 'dots' as const, tone: 'default' as const } });
function validName(value: unknown) { const name = typeof value === 'string' ? value.trim() : ''; if (!name || name.length > 120) throw new BadRequestException('El nombre debe tener entre 1 y 120 caracteres.'); return name; }
type Document = typeof diagrams.$inferSelect.document;
function validDocument(value: unknown): Document {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Documento de Canvas inválido.');
  const document = value as Partial<Document>;
  const background = document.background;
  if (document.schemaVersion !== 1 || !Array.isArray(document.nodes) || !Array.isArray(document.edges) || !document.viewport ||
    ![document.viewport.x, document.viewport.y, document.viewport.zoom].every(item => typeof item === 'number' && Number.isFinite(item)) || document.viewport.zoom <= 0 ||
    document.nodes.some(item => !item || typeof item !== 'object' || typeof (item as { id?: unknown }).id !== 'string' || !(item as { id: string }).id || !(item as { position?: unknown }).position || !(item as { data?: unknown }).data) ||
    document.edges.some(item => !item || typeof item !== 'object' || !['id', 'source', 'target'].every(key => typeof (item as Record<string, unknown>)[key] === 'string')) ||
    (background !== undefined && (!background || !['plain', 'dots', 'grid'].includes(background.variant) || !['default', 'surface'].includes(background.tone))) ||
    JSON.stringify(value).length > 5_000_000) throw new BadRequestException('Documento de Canvas inválido o demasiado grande.');
  return document as Document;
}

@Injectable()
export class DiagramService {
  constructor(@Inject(Database) private readonly database: Database) {}
  private async project(accountId: string, projectId: string) { const [project] = await this.database.db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.accountId, accountId), isNull(projects.deletedAt))).limit(1); if (!project) throw new NotFoundException('Proyecto no encontrado.'); return project; }
  async list(accountId: string, projectId: string, status: 'active' | 'archived') { await this.project(accountId, projectId); return this.database.db.select({ id: diagrams.id, projectId: diagrams.projectId, name: diagrams.name, revision: diagrams.revision, archivedAt: diagrams.archivedAt, createdAt: diagrams.createdAt, updatedAt: diagrams.updatedAt }).from(diagrams).where(and(eq(diagrams.projectId, projectId), isNull(diagrams.deletedAt), status === 'archived' ? isNotNull(diagrams.archivedAt) : isNull(diagrams.archivedAt))).orderBy(desc(diagrams.updatedAt), desc(diagrams.id)); }
  async create(accountId: string, projectId: string, nameValue: unknown) {
    const name = validName(nameValue);
    return this.database.db.transaction(async tx => {
      const [project] = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.accountId, accountId), isNull(projects.deletedAt))).for('update').limit(1);
      if (!project) throw new NotFoundException('Proyecto no encontrado.');
      const [existing] = await tx.select({ id: diagrams.id }).from(diagrams).where(and(eq(diagrams.projectId, projectId), isNull(diagrams.deletedAt))).limit(1);
      if (existing) throw new ConflictException('Este proyecto ya tiene un mapa. Crea otro proyecto para un mapa independiente.');
      const [diagram] = await tx.insert(diagrams).values({ projectId, name, document: emptyDocument() }).returning();
      return diagram!;
    });
  }
  async get(accountId: string, id: string, db: Database['db'] = this.database.db) { const [diagram] = await db.select({ id: diagrams.id, projectId: diagrams.projectId, name: diagrams.name, document: diagrams.document, revision: diagrams.revision, archivedAt: diagrams.archivedAt, createdAt: diagrams.createdAt, updatedAt: diagrams.updatedAt }).from(diagrams).innerJoin(projects, and(eq(projects.id, diagrams.projectId), eq(projects.accountId, accountId), isNull(projects.deletedAt))).where(and(eq(diagrams.id, id), isNull(diagrams.deletedAt))).limit(1); if (!diagram) throw new NotFoundException('Diagrama no encontrado.'); return diagram; }
  async save(accountId: string, id: string, input: { document?: unknown; expectedRevision?: unknown; idempotencyKey?: unknown }) {
    const document = validDocument(input.document);
    if (!Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number) < 0) throw new BadRequestException('Revisión esperada inválida.');
    if (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim() || input.idempotencyKey.length > 120) throw new BadRequestException('Falta la clave de idempotencia.');
    return withSerializationRetry(() => this.database.db.transaction(async tx => {
      const [current] = await tx.select({ revision: diagrams.revision, document: diagrams.document, archivedAt: diagrams.archivedAt, projectId: diagrams.projectId }).from(diagrams).innerJoin(projects, and(eq(projects.id, diagrams.projectId), eq(projects.accountId, accountId), isNull(projects.deletedAt))).where(and(eq(diagrams.id, id), isNull(diagrams.deletedAt))).for('update').limit(1);
      if (!current) throw new NotFoundException('Diagrama no encontrado.');
      const [prior] = await tx.select({ revision: diagramRevisions.revision, document: diagramRevisions.document, createdAt: diagramRevisions.createdAt }).from(diagramRevisions).where(and(eq(diagramRevisions.diagramId, id), eq(diagramRevisions.idempotencyKey, input.idempotencyKey as string))).limit(1);
      if (prior) { if (!isDeepStrictEqual(prior.document, document)) throw new ConflictException('La clave de idempotencia ya se usó para otro documento.'); return { revision: prior.revision, document: prior.document, updatedAt: prior.createdAt }; }
      if (current.archivedAt) throw new ConflictException('El diagrama está archivado.');
      if (current.revision !== input.expectedRevision) throw new ConflictException({ message: 'La revisión remota cambió.', details: { currentRevision: current.revision } });
      const resourceIds = [...new Set(document.nodes.map(node => (node as { data?: { resourceId?: unknown } }).data?.resourceId).filter((value): value is string => typeof value === 'string'))];
      if (resourceIds.some(value => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))) throw new BadRequestException('Referencia de recurso inválida.');
      if (resourceIds.length) { const owned = await tx.select({ id: resources.id }).from(resources).where(and(eq(resources.accountId, accountId), isNull(resources.deletedAt), inArray(resources.id, resourceIds))).for('share'); if (owned.length !== resourceIds.length) throw new NotFoundException('Recurso del Canvas no encontrado.'); }
      const folderNodes = document.nodes.filter(node => (node as { type?: string }).type === 'folder').map(node => (node as { data: { folderId?: unknown; projectId?: unknown } }).data);
      const folderIds = [...new Set(folderNodes.map(node => node.folderId))];
      if (folderNodes.some(node => typeof node.folderId !== 'string' || typeof node.projectId !== 'string' || node.projectId !== current.projectId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(node.folderId))) throw new BadRequestException('Referencia de carpeta inválida.');
      if (folderIds.length) { const owned = await tx.select({ id: folders.id }).from(folders).where(and(eq(folders.projectId, current.projectId), inArray(folders.id, folderIds as string[]))).for('share'); if (owned.length !== folderIds.length) throw new NotFoundException('Carpeta del Canvas no encontrada.'); }
      if (document.edges.some(edge => { const relationId = (edge as { data?: { relationId?: unknown } }).data?.relationId; return relationId !== undefined && typeof relationId !== 'string'; })) throw new BadRequestException('Referencia de Relación inválida.');
      const relationEdges = document.edges.filter(edge => typeof (edge as { data?: { relationId?: unknown } }).data?.relationId === 'string') as { source: string; target: string; data: { relationId: string } }[];
      const relationIds = [...new Set(relationEdges.map(edge => edge.data.relationId))];
      if (relationIds.some(value => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))) throw new BadRequestException('Referencia de Relación inválida.');
      if (relationIds.length) {
        const ownedRelations = await tx.select({ id: relations.id, sourceResourceId: relations.sourceResourceId, targetResourceId: relations.targetResourceId, direction: relations.direction, deletedAt: relations.deletedAt }).from(relations).where(and(eq(relations.accountId, accountId), eq(relations.diagramId, id), inArray(relations.id, relationIds))).for('update');
        if (ownedRelations.length !== relationIds.length) throw new NotFoundException('Relación del Canvas no encontrada.');
        const relationById = new Map(ownedRelations.map(relation => [relation.id, relation]));
        const nodeById = new Map(document.nodes.map(node => [(node as { id: string }).id, node as { type?: string; data?: { resourceId?: unknown } }]));
        for (const edge of relationEdges) {
          const relation = relationById.get(edge.data.relationId)!;
          const source = nodeById.get(edge.source);
          const target = nodeById.get(edge.target);
          const sourceResourceId = source?.type === 'resource' ? source.data?.resourceId : undefined;
          const targetResourceId = target?.type === 'resource' ? target.data?.resourceId : undefined;
          const matches = sourceResourceId === relation.sourceResourceId && targetResourceId === relation.targetResourceId ||
            relation.direction === 'undirected' && sourceResourceId === relation.targetResourceId && targetResourceId === relation.sourceResourceId;
          if (!matches) throw new BadRequestException('Los extremos visuales no corresponden a la Relación.');
        }
      }
      const revision = current.revision + 1; const updatedAt = new Date();
      const previousRelationIds = [...new Set(current.document.edges.map(edge => (edge as { data?: { relationId?: unknown } }).data?.relationId).filter((value): value is string => typeof value === 'string'))];
      const removedRelationIds = previousRelationIds.filter(relationId => !relationIds.includes(relationId));
      if (removedRelationIds.length) await tx.update(relations).set({ deletedAt: updatedAt, purgeAfter: new Date(updatedAt.getTime() + 30 * 86_400_000), updatedAt }).where(and(eq(relations.diagramId, id), isNull(relations.deletedAt), inArray(relations.id, removedRelationIds)));
      if (relationIds.length) await tx.update(relations).set({ deletedAt: null, purgeAfter: null, updatedAt }).where(and(eq(relations.diagramId, id), isNotNull(relations.deletedAt), inArray(relations.id, relationIds)));
      await tx.update(diagrams).set({ document, revision, updatedAt }).where(eq(diagrams.id, id));
      await tx.insert(diagramRevisions).values({ diagramId: id, revision, idempotencyKey: input.idempotencyKey as string, document, createdAt: updatedAt });
      return { revision, document, updatedAt };
    }, { isolationLevel: 'serializable' }));
  }
  async rename(accountId: string, id: string, nameValue: unknown) {
    const source = await this.get(accountId, id);
    const name = validName(nameValue);
    return this.database.db.transaction(async tx => {
      const [diagram] = await tx.update(diagrams).set({ name, updatedAt: new Date() }).where(eq(diagrams.id, id)).returning();
      await tx.update(projects).set({ name, updatedAt: new Date() }).where(eq(projects.id, source.projectId));
      return diagram!;
    });
  }
  async duplicate(accountId: string, id: string, nameValue?: unknown) {
    const source = await this.get(accountId, id);
    const name = nameValue == null ? `${source.name} (copia)`.slice(0, 120) : validName(nameValue);
    return this.database.db.transaction(async tx => {
      const [parent] = await tx.select({ collectionFolderId: projects.collectionFolderId }).from(projects).where(eq(projects.id, source.projectId)).limit(1);
      const [project] = await tx.insert(projects).values({ accountId, name, collectionFolderId: parent?.collectionFolderId ?? null }).returning();
      const sourceFolders = await tx.select().from(folders).where(eq(folders.projectId, source.projectId));
      const folderIds = new Map(sourceFolders.map(folder => [folder.id, randomUUID()]));
      if (sourceFolders.length) await tx.insert(folders).values(sourceFolders.map(folder => ({ id: folderIds.get(folder.id)!, projectId: project!.id, name: folder.name, parentFolderId: folder.parentFolderId ? folderIds.get(folder.parentFolderId) ?? null : null, archivedAt: folder.archivedAt })));
      const document = structuredClone(source.document);
      const selected = await tx.select().from(projectResources).where(eq(projectResources.projectId, source.projectId));
      const selections = new Map(selected.map(item => [item.resourceId, item.folderId ? folderIds.get(item.folderId) ?? null : null]));
      for (const node of document.nodes) {
        const resourceId = (node as { data?: { resourceId?: unknown } }).data?.resourceId;
        if (typeof resourceId === 'string' && !selections.has(resourceId)) selections.set(resourceId, null);
      }
      if (selections.size) await tx.insert(projectResources).values([...selections].map(([resourceId, folderId]) => ({ projectId: project!.id, resourceId, folderId })));
      document.nodes = document.nodes.map(node => {
        const item = node as { type?: string; data?: { folderId?: string; projectId?: string } };
        if (item.type !== 'folder' || !item.data?.folderId) return node;
        return { ...item, data: { ...item.data, folderId: folderIds.get(item.data.folderId) ?? item.data.folderId, projectId: project!.id } };
      });
      const [copy] = await tx.insert(diagrams).values({ projectId: project!.id, name, document }).returning();
      const relationIds = [...new Set(document.edges.map(edge => (edge as { data?: { relationId?: unknown } }).data?.relationId).filter((value): value is string => typeof value === 'string'))];
      if (relationIds.length) {
        const originals = await tx.select().from(relations).where(and(eq(relations.diagramId, id), inArray(relations.id, relationIds)));
        const ids = new Map(originals.map(relation => [relation.id, randomUUID()]));
        await tx.insert(relations).values(originals.map(relation => ({ ...relation, id: ids.get(relation.id)!, diagramId: copy!.id })));
        const evidence = await tx.select().from(relationEvidence).where(inArray(relationEvidence.relationId, relationIds));
        if (evidence.length) await tx.insert(relationEvidence).values(evidence.filter(item => ids.has(item.relationId)).map(item => ({ ...item, id: randomUUID(), relationId: ids.get(item.relationId)! })));
        document.edges = document.edges.map(edge => {
          const item = edge as { data?: { relationId?: string } };
          const replacement = item.data?.relationId ? ids.get(item.data.relationId) : undefined;
          return replacement ? { ...item, data: { ...item.data, relationId: replacement } } : edge;
        });
        await tx.update(diagrams).set({ document }).where(eq(diagrams.id, copy!.id));
      }
      return { ...copy!, document };
    });
  }
  async restore(accountId: string, id: string) {
    const source = await this.get(accountId, id);
    return this.database.db.transaction(async tx => {
      const [diagram] = await tx.update(diagrams).set({ archivedAt: null, updatedAt: new Date() }).where(and(eq(diagrams.id, id), isNull(diagrams.deletedAt))).returning();
      await tx.update(projects).set({ archivedAt: null, updatedAt: new Date() }).where(eq(projects.id, source.projectId));
      return diagram!;
    });
  }
}
