import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { Database } from '../../infrastructure/database/database.js';
import { withSerializationRetry } from '../../infrastructure/database/serialization-retry.js';
import { diagramRevisions, diagrams, projects, relationTypes, relations, resources } from '../../infrastructure/database/schema.js';

export const commonRelationTypes = [
  { key: 'supports', label: 'Respalda' },
  { key: 'contradicts', label: 'Contradice' },
  { key: 'depends_on', label: 'Depende de' },
  { key: 'related_to', label: 'Se relaciona con' },
] as const;

type Document = typeof diagrams.$inferSelect.document;
type CanvasNode = { id?: unknown; type?: unknown; data?: { resourceId?: unknown } };
type CanvasEdge = { id?: unknown; source?: unknown; target?: unknown; data?: { relationId?: unknown; operationId?: unknown } };
type CreateInput = { sourceNodeId?: unknown; targetNodeId?: unknown; direction?: unknown; typeKey?: unknown; customTypeName?: unknown; expectedRevision?: unknown; idempotencyKey?: unknown; reuseExisting?: unknown };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class RelationService {
  constructor(@Inject(Database) private readonly database: Database) {}

  async types(accountId: string, projectId: string) {
    const [project] = await this.database.db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.accountId, accountId), isNull(projects.deletedAt))).limit(1);
    if (!project) throw new NotFoundException('Proyecto no encontrado.');
    const custom = await this.database.db.select({ id: relationTypes.id, label: relationTypes.label }).from(relationTypes).where(and(eq(relationTypes.accountId, accountId), eq(relationTypes.originProjectId, projectId)));
    return [...commonRelationTypes, ...custom.map(item => ({ key: `custom:${item.id}`, label: item.label }))];
  }

  async create(accountId: string, diagramId: string, input: CreateInput) {
    const sourceNodeId = typeof input.sourceNodeId === 'string' ? input.sourceNodeId : '';
    const targetNodeId = typeof input.targetNodeId === 'string' ? input.targetNodeId : '';
    if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) throw new BadRequestException('Elige dos representaciones de Recursos diferentes.');
    if (input.direction !== 'directed' && input.direction !== 'undirected') throw new BadRequestException('Elige una dirección válida.');
    const direction: 'directed' | 'undirected' = input.direction;
    if (!Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number) < 0) throw new BadRequestException('Revisión esperada inválida.');
    if (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim() || input.idempotencyKey.length > 120) throw new BadRequestException('Falta la clave de idempotencia.');
    const customTypeName = typeof input.customTypeName === 'string' ? input.customTypeName.trim().replace(/\s+/g, ' ') : '';
    const requestedTypeKey = typeof input.typeKey === 'string' ? input.typeKey : '';
    if (customTypeName && (customTypeName.length < 2 || customTypeName.length > 60)) throw new BadRequestException('El tipo personalizado debe tener entre 2 y 60 caracteres.');
    if (!customTypeName && !commonRelationTypes.some(item => item.key === requestedTypeKey) && !/^custom:[0-9a-f-]{36}$/i.test(requestedTypeKey)) throw new BadRequestException('Elige un tipo de Relación válido.');

    return withSerializationRetry(() => this.database.db.transaction(async tx => {
      const [current] = await tx.select({ projectId: diagrams.projectId, document: diagrams.document, revision: diagrams.revision, archivedAt: diagrams.archivedAt }).from(diagrams).innerJoin(projects, and(eq(projects.id, diagrams.projectId), eq(projects.accountId, accountId), isNull(projects.deletedAt))).where(and(eq(diagrams.id, diagramId), isNull(diagrams.deletedAt))).for('update').limit(1);
      if (!current) throw new NotFoundException('Diagrama no encontrado.');
      if (current.archivedAt) throw new ConflictException('Restaura el diagrama para editarlo.');
      const [prior] = await tx.select({ revision: diagramRevisions.revision, document: diagramRevisions.document }).from(diagramRevisions).where(and(eq(diagramRevisions.diagramId, diagramId), eq(diagramRevisions.idempotencyKey, input.idempotencyKey as string))).limit(1);
      if (prior) {
        const edge = (prior.document.edges as CanvasEdge[]).find(item => item.data?.operationId === input.idempotencyKey);
        if (!edge || typeof edge.data?.relationId !== 'string') throw new ConflictException('La clave de idempotencia ya se usó.');
        const priorData = edge.data as Record<string, unknown>;
        if (edge.source !== sourceNodeId || edge.target !== targetNodeId || priorData.direction !== direction || (customTypeName ? priorData.typeLabel !== customTypeName : priorData.typeKey !== requestedTypeKey)) throw new ConflictException('La clave de idempotencia ya se usó para otra Relación.');
        return { relationId: edge.data.relationId, edgeId: edge.id, revision: prior.revision, document: prior.document, reused: false };
      }
      if (current.revision !== input.expectedRevision) throw new ConflictException({ message: 'El diagrama cambió. Recarga antes de crear la Relación.', details: { currentRevision: current.revision } });
      const nodes = current.document.nodes as CanvasNode[];
      const source = nodes.find(item => item.id === sourceNodeId);
      const target = nodes.find(item => item.id === targetNodeId);
      if (source?.type !== 'resource' || target?.type !== 'resource' || typeof source.data?.resourceId !== 'string' || typeof target.data?.resourceId !== 'string') throw new BadRequestException('Las Relaciones del MVP solo conectan Recursos. Usa una línea visual para Carpetas, Grupos o Anotaciones.');
      const sourceResourceId = source.data.resourceId;
      const targetResourceId = target.data.resourceId;
      if (!uuid.test(sourceResourceId) || !uuid.test(targetResourceId) || sourceResourceId === targetResourceId) throw new BadRequestException('Elige dos Recursos diferentes.');
      const owned = await tx.select({ id: resources.id }).from(resources).where(and(eq(resources.accountId, accountId), isNull(resources.deletedAt), inArray(resources.id, [sourceResourceId, targetResourceId]))).for('share');
      if (owned.length !== 2) throw new NotFoundException('Uno de los Recursos no pertenece a esta Cuenta.');

      let typeKey = requestedTypeKey;
      let typeLabel = commonRelationTypes.find(item => item.key === typeKey)?.label ?? '';
      if (customTypeName) {
        const labelKey = customTypeName.normalize('NFKC').toLocaleLowerCase('es');
        const [created] = await tx.insert(relationTypes).values({ accountId, originProjectId: current.projectId, label: customTypeName, labelKey }).onConflictDoNothing().returning({ id: relationTypes.id });
        const [type] = created ? [created] : await tx.select({ id: relationTypes.id }).from(relationTypes).where(and(eq(relationTypes.originProjectId, current.projectId), eq(relationTypes.labelKey, labelKey))).limit(1);
        if (!type) throw new ConflictException('No se pudo recuperar el tipo personalizado.');
        typeKey = `custom:${type.id}`;
        typeLabel = customTypeName;
      } else if (typeKey.startsWith('custom:')) {
        const [type] = await tx.select({ id: relationTypes.id, label: relationTypes.label }).from(relationTypes).where(and(eq(relationTypes.id, typeKey.slice(7)), eq(relationTypes.accountId, accountId), eq(relationTypes.originProjectId, current.projectId))).limit(1);
        if (!type) throw new NotFoundException('Tipo de Relación no disponible en este Proyecto.');
        typeLabel = type.label;
      }
      const [from, to] = direction === 'undirected' && sourceResourceId > targetResourceId ? [targetResourceId, sourceResourceId] : [sourceResourceId, targetResourceId];
      const [createdRelation] = await tx.insert(relations).values({ accountId, sourceResourceId: from, targetResourceId: to, direction, typeKey }).onConflictDoNothing().returning({ id: relations.id });
      const [relation] = createdRelation ? [createdRelation] : await tx.select({ id: relations.id }).from(relations).where(and(eq(relations.accountId, accountId), eq(relations.sourceResourceId, from), eq(relations.targetResourceId, to), eq(relations.direction, direction), eq(relations.typeKey, typeKey))).limit(1);
      if (!relation) throw new ConflictException('No se pudo recuperar la Relación.');
      if (!createdRelation && input.reuseExisting !== true) throw new ConflictException({ message: 'Ya existe una Relación equivalente. Puedes mostrarla en este Diagrama.', details: { relationId: relation.id } });
      const edges = current.document.edges as CanvasEdge[];
      const alreadyShown = edges.find(item => item.data?.relationId === relation.id && item.source === sourceNodeId && item.target === targetNodeId);
      if (alreadyShown) return { relationId: relation.id, edgeId: alreadyShown.id, revision: current.revision, document: current.document, reused: true };
      const edgeId = crypto.randomUUID();
      const edge = { id: edgeId, source: sourceNodeId, target: targetNodeId, type: 'editable', ...(direction === 'directed' ? { markerEnd: { type: 'arrowclosed' } } : {}), data: { relationId: relation.id, typeKey, typeLabel, direction, operationId: input.idempotencyKey } };
      const document: Document = { ...current.document, edges: [...current.document.edges, edge] };
      const revision = current.revision + 1;
      const updatedAt = new Date();
      await tx.update(diagrams).set({ document, revision, updatedAt }).where(eq(diagrams.id, diagramId));
      await tx.insert(diagramRevisions).values({ diagramId, revision, idempotencyKey: input.idempotencyKey as string, document, createdAt: updatedAt });
      return { relationId: relation.id, edgeId, revision, document, reused: !createdRelation };
    }, { isolationLevel: 'serializable' }));
  }
}
