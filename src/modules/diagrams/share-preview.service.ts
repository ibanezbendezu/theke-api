import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { Database } from '../../infrastructure/database/database.js';
import { relations, resourceAccessibility, resourceLinks, resources, resourceVersions } from '../../infrastructure/database/schema.js';
import { DiagramService } from './diagram.service.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const supportedMedia = new Set(['application/pdf', 'text/plain', 'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'video/mp4', 'video/webm']);
type CanvasNode = { id?: unknown; type?: unknown; hidden?: unknown; data?: { resourceId?: unknown } };
type CanvasEdge = { source?: unknown; target?: unknown; hidden?: unknown; data?: { relationId?: unknown } };

@Injectable()
export class SharePreviewService {
  constructor(@Inject(Database) private readonly database: Database, @Inject(DiagramService) private readonly diagrams: DiagramService) {}

  async get(accountId: string, diagramId: string, db: Database['db'] = this.database.db) {
    const diagram = await this.diagrams.get(accountId, diagramId, db);
    if (diagram.archivedAt) throw new ConflictException('El diagrama está archivado.');
    const nodes = diagram.document.nodes as CanvasNode[];
    const edges = diagram.document.edges as CanvasEdge[];
    const represented = nodes.filter(node => node?.type === 'resource' && node.hidden !== true);
    const resourceIds = [...new Set(represented.map(node => node.data?.resourceId))];
    if (resourceIds.some(id => typeof id !== 'string' || !uuid.test(id))) throw new ConflictException('Referencia de recurso no disponible.');
    const ids = resourceIds as string[];
    const resourceRows = ids.length ? await db.select({
      id: resources.id, title: resources.title, type: resources.type, description: resources.description,
      versionId: resourceVersions.id, content: resourceVersions.content, mediaType: resourceVersions.mediaType, storageKey: resourceVersions.storageKey,
      accessibilityText: resourceAccessibility.text, url: resourceLinks.url,
    }).from(resources).innerJoin(resourceVersions, and(eq(resourceVersions.id, resources.currentVersionId), eq(resourceVersions.resourceId, resources.id)))
      .leftJoin(resourceAccessibility, eq(resourceAccessibility.resourceId, resources.id))
      .leftJoin(resourceLinks, eq(resourceLinks.resourceId, resources.id))
      .where(and(eq(resources.accountId, accountId), isNull(resources.deletedAt), isNull(resources.archivedAt), inArray(resources.id, ids))) : [];
    const resourceById = new Map(resourceRows.filter(row => ids.includes(row.id) && !('archivedAt' in row && row.archivedAt) && !('deletedAt' in row && row.deletedAt)).map(row => [row.id, row]));
    if (resourceById.size !== ids.length) throw new ConflictException('Recurso del Canvas no disponible.');

    const warnings: { resourceId: string; field: string; message: string }[] = [];
    const publicResources = ids.map(id => {
      const row = resourceById.get(id)!;
      if (row.type === 'link' && !row.url) throw new ConflictException('Enlace del Canvas no disponible.');
      if (row.type === 'note') {
        for (const [, reference] of (row.content ?? '').matchAll(/\[\[([^\]]+)\]\]/g)) {
          const match = /^resource:([0-9a-f-]{36})(?:\|[^\]]*)?$/i.exec(reference ?? '');
          if (!match || !ids.includes(match[1]!)) throw new ConflictException('La nota contiene referencias no representadas.');
        }
      }
      if (row.type === 'file') {
        if (!row.storageKey) warnings.push({ resourceId: id, field: 'file', message: 'El archivo original no está disponible para compartir.' });
        if (!row.accessibilityText?.trim()) warnings.push({ resourceId: id, field: 'accessibilityText', message: 'El archivo necesita texto de accesibilidad.' });
        if (!row.mediaType || !supportedMedia.has(row.mediaType.toLowerCase())) warnings.push({ resourceId: id, field: 'mediaType', message: 'El formato del archivo no es compatible con la vista previa.' });
      }
      return {
        id: row.id, title: row.title, type: row.type, description: row.description ?? null,
        content: row.type === 'note' ? row.content : null,
        url: row.type === 'link' ? row.url : null,
        accessibilityText: row.type === 'file' || row.type === 'link' ? row.accessibilityText ?? null : null,
        mediaType: row.type === 'file' ? row.mediaType ?? null : null,
      };
    });

    const visibleNodeIds = new Set(nodes.filter(node => node?.hidden !== true).map(node => node.id));
    const relationEdges = edges.filter(edge => edge?.data?.relationId !== undefined && edge.hidden !== true && visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target));
    const relationIds = [...new Set(relationEdges.map(edge => edge.data?.relationId))];
    if (relationIds.some(id => typeof id !== 'string' || !uuid.test(id))) throw new ConflictException('Referencia de relación no disponible.');
    const relationKeys = relationIds as string[];
    const relationRows = relationKeys.length ? await db.select({
      id: relations.id, sourceResourceId: relations.sourceResourceId, targetResourceId: relations.targetResourceId,
      direction: relations.direction, typeKey: relations.typeKey, label: relations.label, explanation: relations.explanation,
    }).from(relations).where(and(eq(relations.accountId, accountId), isNull(relations.deletedAt), isNull(relations.archivedAt), inArray(relations.id, relationKeys))) : [];
    const relationById = new Map(relationRows.filter(row => relationKeys.includes(row.id) && !('archivedAt' in row && row.archivedAt) && !('deletedAt' in row && row.deletedAt)).map(row => [row.id, row]));
    if (relationById.size !== relationKeys.length) throw new ConflictException('Relación del Canvas no disponible.');
    const nodeById = new Map(represented.map(node => [node.id, node.data?.resourceId]));
    for (const edge of relationEdges) {
      const relation = relationById.get(edge.data!.relationId as string)!;
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!ids.includes(relation.sourceResourceId) || !ids.includes(relation.targetResourceId) ||
        !(source === relation.sourceResourceId && target === relation.targetResourceId ||
          relation.direction === 'undirected' && source === relation.targetResourceId && target === relation.sourceResourceId)) {
        throw new ConflictException('Los extremos de la relación no corresponden al Canvas.');
      }
    }
    const projection = { diagramName: diagram.name, revision: diagram.revision, resources: publicResources,
      relations: relationKeys.map(id => { const row = relationById.get(id)!; return {
        id: row.id, sourceResourceId: row.sourceResourceId, targetResourceId: row.targetResourceId,
        direction: row.direction, typeKey: row.typeKey, label: row.label ?? null, explanation: row.explanation ?? null,
      }; }) };
    const fingerprint = createHash('sha256').update(JSON.stringify({ projection, versions: ids.map(id => resourceById.get(id)!.versionId) })).digest('hex');
    return { ...projection, fingerprint, warnings, ready: warnings.length === 0 };
  }
}
