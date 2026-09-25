import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { Database } from '../../infrastructure/database/database.js';
import { withSerializationRetry } from '../../infrastructure/database/serialization-retry.js';
import { diagramRevisions, diagrams, projects, relationEvidence, relationTypes, relations, resources } from '../../infrastructure/database/schema.js';

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
type EditInput = { label?: unknown; explanation?: unknown; provenance?: unknown; evidenceStatus?: unknown; evidence?: unknown; expectedRevision?: unknown };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function optionalText(value: unknown, name: string, max: number) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > max) throw new BadRequestException(`${name} inválida o demasiado larga.`);
  return value.trim() || null;
}

@Injectable()
export class RelationService {
  constructor(@Inject(Database) private readonly database: Database) {}

  async available(accountId: string, diagramId: string) {
    const [diagram] = await this.database.db.select({ document: diagrams.document }).from(diagrams).innerJoin(projects, and(eq(projects.id, diagrams.projectId), eq(projects.accountId, accountId), isNull(projects.deletedAt))).where(and(eq(diagrams.id, diagramId), isNull(diagrams.deletedAt))).limit(1);
    if (!diagram) throw new NotFoundException('Diagrama no encontrado.');
    const nodes = (diagram.document.nodes as CanvasNode[]).filter(node => node.type === 'resource' && typeof node.id === 'string' && typeof node.data?.resourceId === 'string');
    const resourceIds = [...new Set(nodes.map(node => node.data!.resourceId as string))];
    if (resourceIds.length < 2) return [];
    const shown = new Set((diagram.document.edges as CanvasEdge[]).map(edge => edge.data?.relationId).filter((id): id is string => typeof id === 'string'));
    const candidates = await this.database.db.select({ id: relations.id, sourceResourceId: relations.sourceResourceId, targetResourceId: relations.targetResourceId, direction: relations.direction, typeKey: relations.typeKey, label: relations.label, evidenceStatus: relations.evidenceStatus, sourceTitle: resources.title }).from(relations).innerJoin(resources, eq(resources.id, relations.sourceResourceId)).where(and(eq(relations.accountId, accountId), isNull(relations.deletedAt), isNull(relations.archivedAt), inArray(relations.sourceResourceId, resourceIds), inArray(relations.targetResourceId, resourceIds)));
    const targetTitles = await this.database.db.select({ id: resources.id, title: resources.title }).from(resources).where(inArray(resources.id, resourceIds));
    const titleById = new Map(targetTitles.map(item => [item.id, item.title]));
    const customIds = candidates.map(item => item.typeKey.startsWith('custom:') ? item.typeKey.slice(7) : null).filter((id): id is string => Boolean(id));
    const customTypes = customIds.length ? await this.database.db.select({ id: relationTypes.id, label: relationTypes.label }).from(relationTypes).where(and(eq(relationTypes.accountId, accountId), inArray(relationTypes.id, customIds))) : [];
    const typeById = new Map(customTypes.map(item => [item.id, item.label]));
    return candidates.filter(item => !shown.has(item.id)).map(item => ({ relationId: item.id, sourceResourceId: item.sourceResourceId, targetResourceId: item.targetResourceId, sourceNodeId: nodes.find(node => node.data?.resourceId === item.sourceResourceId)!.id as string, targetNodeId: nodes.find(node => node.data?.resourceId === item.targetResourceId)!.id as string, sourceTitle: item.sourceTitle, targetTitle: titleById.get(item.targetResourceId) ?? 'Recurso', direction: item.direction, typeKey: item.typeKey, typeLabel: item.typeKey.startsWith('custom:') ? typeById.get(item.typeKey.slice(7)) ?? item.typeKey : commonRelationTypes.find(type => type.key === item.typeKey)?.label ?? item.typeKey, label: item.label, evidenceStatus: item.evidenceStatus }));
  }

  async types(accountId: string, projectId: string) {
    const [project] = await this.database.db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.accountId, accountId), isNull(projects.deletedAt))).limit(1);
    if (!project) throw new NotFoundException('Proyecto no encontrado.');
    const custom = await this.database.db.select({ id: relationTypes.id, label: relationTypes.label }).from(relationTypes).where(and(eq(relationTypes.accountId, accountId), eq(relationTypes.originProjectId, projectId)));
    return [...commonRelationTypes, ...custom.map(item => ({ key: `custom:${item.id}`, label: item.label }))];
  }

  async create(accountId: string, authorUserId: string, diagramId: string, input: CreateInput) {
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
      const [createdRelation] = await tx.insert(relations).values({ accountId, sourceResourceId: from, targetResourceId: to, direction, typeKey, createdByUserId: authorUserId, updatedByUserId: authorUserId }).onConflictDoNothing().returning({ id: relations.id });
      const [relation] = createdRelation ? [createdRelation] : await tx.select({ id: relations.id, archivedAt: relations.archivedAt, deletedAt: relations.deletedAt }).from(relations).where(and(eq(relations.accountId, accountId), eq(relations.sourceResourceId, from), eq(relations.targetResourceId, to), eq(relations.direction, direction), eq(relations.typeKey, typeKey))).limit(1);
      if (!relation) throw new ConflictException('No se pudo recuperar la Relación.');
      if ('archivedAt' in relation && (relation.archivedAt || relation.deletedAt)) throw new ConflictException('La Relación equivalente está archivada. Restáurala antes de mostrarla.');
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

  async get(accountId: string, id: string) {
    const [relation] = await this.database.db.select().from(relations).where(and(eq(relations.id, id), eq(relations.accountId, accountId))).limit(1);
    if (!relation) throw new NotFoundException('Relación no encontrada.');
    const endpoints = await this.database.db.select({ id: resources.id, title: resources.title }).from(resources).where(and(eq(resources.accountId, accountId), inArray(resources.id, [relation.sourceResourceId, relation.targetResourceId])));
    const type = relation.typeKey.startsWith('custom:') ? await this.database.db.select({ label: relationTypes.label }).from(relationTypes).where(and(eq(relationTypes.id, relation.typeKey.slice(7)), eq(relationTypes.accountId, accountId))).limit(1) : [];
    const evidence = await this.database.db.select({ id: relationEvidence.id, resourceId: relationEvidence.resourceId, title: resources.title, excerpt: relationEvidence.excerpt, note: relationEvidence.note }).from(relationEvidence).innerJoin(resources, eq(resources.id, relationEvidence.resourceId)).where(eq(relationEvidence.relationId, id));
    return { ...relation, typeLabel: type[0]?.label ?? commonRelationTypes.find(item => item.key === relation.typeKey)?.label ?? relation.typeKey, source: endpoints.find(item => item.id === relation.sourceResourceId)!, target: endpoints.find(item => item.id === relation.targetResourceId)!, evidence };
  }

  async restore(accountId: string, id: string) {
    const [relation] = await this.database.db.update(relations).set({ archivedAt: null, deletedAt: null, purgeAfter: null, updatedAt: new Date() }).where(and(eq(relations.id, id), eq(relations.accountId, accountId))).returning({ id: relations.id });
    if (!relation) throw new NotFoundException('Relación no encontrada.');
    return this.get(accountId, id);
  }

  async update(accountId: string, authorUserId: string, id: string, input: EditInput) {
    const label = optionalText(input.label, 'Etiqueta', 160);
    const explanation = optionalText(input.explanation, 'Explicación', 10_000);
    const provenance = optionalText(input.provenance, 'Procedencia', 2_000);
    if (!['none', 'needs_evidence', 'confirmed'].includes(input.evidenceStatus as string)) throw new BadRequestException('Estado de evidencia inválido.');
    if (!Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number) < 0) throw new BadRequestException('Revisión esperada inválida.');
    if (!Array.isArray(input.evidence) || input.evidence.length > 10) throw new BadRequestException('La Relación admite hasta 10 citas.');
    const evidence = input.evidence.map((item: unknown) => {
      const value = item as { resourceId?: unknown; excerpt?: unknown; note?: unknown };
      if (!value || typeof value !== 'object' || typeof value.resourceId !== 'string' || !uuid.test(value.resourceId)) throw new BadRequestException('Referencia de evidencia inválida.');
      return { resourceId: value.resourceId, excerpt: optionalText(value.excerpt, 'Fragmento', 2_000), note: optionalText(value.note, 'Nota de evidencia', 2_000) };
    });
    if (input.evidenceStatus === 'confirmed' && evidence.length === 0) throw new BadRequestException('Añade una cita antes de marcar la evidencia como confirmada.');
    if (input.evidenceStatus === 'none' && evidence.length > 0) throw new BadRequestException('Elige un estado de evidencia para las citas.');
    await withSerializationRetry(() => this.database.db.transaction(async tx => {
      const [current] = await tx.select().from(relations).where(and(eq(relations.id, id), eq(relations.accountId, accountId))).for('update').limit(1);
      if (!current || current.deletedAt) throw new NotFoundException('Relación no encontrada.');
      if (current.archivedAt) throw new ConflictException('Restaura la Relación para editarla.');
      if (current.revision !== input.expectedRevision) throw new ConflictException({ message: 'La Relación cambió en otra sesión.', details: { currentRevision: current.revision } });
      const evidenceIds = [...new Set(evidence.map(item => item.resourceId))];
      if (evidenceIds.length) {
        const owned = await tx.select({ id: resources.id }).from(resources).where(and(eq(resources.accountId, accountId), isNull(resources.deletedAt), inArray(resources.id, evidenceIds))).for('share');
        if (owned.length !== evidenceIds.length) throw new NotFoundException('Recurso de evidencia no encontrado en esta Cuenta.');
      }
      await tx.update(relations).set({ label, explanation, provenance, evidenceStatus: input.evidenceStatus as 'none' | 'needs_evidence' | 'confirmed', revision: current.revision + 1, updatedByUserId: authorUserId, updatedAt: new Date() }).where(eq(relations.id, id));
      await tx.delete(relationEvidence).where(eq(relationEvidence.relationId, id));
      if (evidence.length) await tx.insert(relationEvidence).values(evidence.map(item => ({ relationId: id, ...item })));
    }, { isolationLevel: 'serializable' }));
    return this.get(accountId, id);
  }
}
