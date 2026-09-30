import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { Database } from '../../infrastructure/database/database.js';
import { folders, projectResources, relationEvidence, relations, resourceAccessibility, resourceLinks, resources, resourceVersions } from '../../infrastructure/database/schema.js';
import { DiagramService } from './diagram.service.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const supportedMedia = new Set(['application/pdf', 'text/plain', 'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'video/mp4', 'video/webm']);
type CanvasNode = { id?: unknown; type?: unknown; hidden?: unknown; parentId?: unknown; position?: { x?: unknown; y?: unknown }; width?: unknown; height?: unknown; data?: Record<string, unknown> };
type CanvasEdge = { source?: unknown; target?: unknown; hidden?: unknown; sourceHandle?: unknown; targetHandle?: unknown; data?: Record<string, unknown> };
const nodeTypes = new Set(['resource', 'folder', 'container', 'annotation', 'text', 'shape', 'link', 'media', 'document', 'audio']);
const text = (value: unknown, max = 500) => typeof value === 'string' ? value.slice(0, max) : undefined;
const number = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
const color = (value: unknown) => typeof value === 'string' && (/^#[0-9a-f]{3,8}$/i.test(value) || /^var\(--color-[a-z-]+\)$/.test(value)) ? value : undefined;
const url = (value: unknown) => { if (typeof value !== 'string') return undefined; try { const parsed = new URL(value); return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href.slice(0, 2048) : undefined; } catch { return undefined; } };

@Injectable()
export class SharePreviewService {
  constructor(@Inject(Database) private readonly database: Database, @Inject(DiagramService) private readonly diagrams: DiagramService) {}

  async get(accountId: string, diagramId: string, db: Database['db'] = this.database.db) {
    const diagram = await this.diagrams.get(accountId, diagramId, db);
    if (diagram.archivedAt) throw new ConflictException('El diagrama está archivado.');
    const nodes = diagram.document.nodes as CanvasNode[];
    const edges = diagram.document.edges as CanvasEdge[];
    const nodesById = new Map(nodes.map(node => [node.id, node]));
    if (nodesById.size !== nodes.length) throw new ConflictException('El Canvas contiene identificadores repetidos.');
    const resolved = new Map<unknown, { visible: boolean; x: number; y: number }>();
    const resolving = new Set<unknown>();
    const positionOf = (node: CanvasNode): { visible: boolean; x: number; y: number } => {
      if (resolved.has(node.id)) return resolved.get(node.id)!;
      if (resolving.has(node.id)) throw new ConflictException('El Canvas contiene una jerarquía circular.');
      resolving.add(node.id);
      const x = node.position?.x; const y = node.position?.y;
      if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y) || Math.abs(x) > 1_000_000 || Math.abs(y) > 1_000_000)
        throw new ConflictException('La posición de un elemento del Canvas no es publicable.');
      const parent = node.parentId == null ? null : nodesById.get(node.parentId);
      if (node.parentId != null && !parent) throw new ConflictException('El Canvas contiene un grupo no disponible.');
      const ancestor = parent ? positionOf(parent) : { visible: true, x: 0, y: 0 };
      const result = { visible: node.hidden !== true && ancestor.visible, x: x + ancestor.x, y: y + ancestor.y };
      if (Math.abs(result.x) > 1_000_000 || Math.abs(result.y) > 1_000_000) throw new ConflictException('La posición de un elemento del Canvas no es publicable.');
      resolving.delete(node.id); resolved.set(node.id, result);
      return result;
    };
    const visibleNodes = nodes.filter(node => positionOf(node).visible);
    if (visibleNodes.some(node => !nodeTypes.has(String(node.type)))) throw new ConflictException('El Canvas contiene un elemento sin vista pública compatible.');
    const represented = visibleNodes.filter(node => node.type === 'resource');
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
    const folderIds = [...new Set(visibleNodes.filter(node => node.type === 'folder').map(node => node.data?.folderId))];
    if (folderIds.some(id => typeof id !== 'string' || !uuid.test(id))) throw new ConflictException('Carpeta del Canvas no disponible.');
    const folderRows = folderIds.length ? await db.select({ id: folders.id, name: folders.name }).from(folders)
      .where(and(eq(folders.projectId, diagram.projectId), isNull(folders.archivedAt), inArray(folders.id, folderIds as string[]))) : [];
    const folderById = new Map(folderRows.map(row => [row.id, row]));
    if (folderById.size !== folderIds.length) throw new ConflictException('Carpeta del Canvas no disponible.');
    const folderCounts = folderIds.length ? await db.select({ folderId: projectResources.folderId }).from(projectResources)
      .innerJoin(resources, eq(resources.id, projectResources.resourceId))
      .where(and(eq(projectResources.projectId, diagram.projectId), inArray(projectResources.folderId, folderIds as string[]), isNull(resources.archivedAt), isNull(resources.deletedAt))) : [];

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

    const visibleNodeIds = new Set(nodes.filter(node => positionOf(node).visible).map(node => node.id));
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
    const evidenceRows = relationKeys.length && ids.length ? await db.select({ id: relationEvidence.id, relationId: relationEvidence.relationId, resourceId: relationEvidence.resourceId,
      excerpt: relationEvidence.excerpt, note: relationEvidence.note, pageNumber: relationEvidence.pageNumber }).from(relationEvidence)
      .where(and(inArray(relationEvidence.relationId, relationKeys), inArray(relationEvidence.resourceId, ids))) : [];
    evidenceRows.sort((a, b) => a.id.localeCompare(b.id));
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
    const publicNodeId = new Map(visibleNodes.map((node, index) => [node.id, `n${index}`]));
    const clean = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
    const backgroundVariant = diagram.document.background?.variant;
    const layout = {
      background: {
        variant: backgroundVariant === 'plain' || backgroundVariant === 'dots' || backgroundVariant === 'grid' ? backgroundVariant : 'dots',
        tone: diagram.document.background?.tone === 'surface' ? 'surface' : 'default',
      },
      nodes: visibleNodes.map((node, index) => {
        const data = node.data ?? {}; const type = String(node.type);
        const common = { id: `n${index}`, type, x: positionOf(node).x, y: positionOf(node).y,
          width: number(node.width, 20, 5000), height: number(node.height, 4, 5000),
          caption: text(data.caption, 160), accent: ['default', 'primary', 'muted'].includes(String(data.accent)) ? data.accent : undefined };
        const specific = type === 'resource' ? { resourceId: data.resourceId } : type === 'folder' ? {
          folderName: folderById.get(data.folderId as string)?.name,
          folderCount: folderCounts.filter(row => row.folderId === data.folderId).length,
        } : type === 'container' ? { label: text(data.label, 160), color: color(data.color) } : type === 'annotation' ? {
          annotationKind: ['text', 'shape', 'line'].includes(String(data.kind)) ? data.kind : 'text', text: text(data.text, 2000),
          fontSize: number(data.fontSize, 8, 96), align: ['left', 'center', 'right'].includes(String(data.align)) ? data.align : undefined,
          shape: ['rectangle', 'ellipse'].includes(String(data.shape)) ? data.shape : undefined,
          color: ['default', 'primary', 'muted'].includes(String(data.color)) ? data.color : undefined,
          thickness: number(data.thickness, 1, 40), dash: ['solid', 'dashed'].includes(String(data.dash)) ? data.dash : undefined,
          x1: number(data.x1, 0, 100), y1: number(data.y1, 0, 100), x2: number(data.x2, 0, 100), y2: number(data.y2, 0, 100),
        } : type === 'text' ? { text: text(data.text, 2000) } : type === 'shape' ? {
          shapeType: ['rectangle', 'circle', 'polygon', 'line'].includes(String(data.shapeType)) ? data.shapeType : 'rectangle',
          sides: number(data.sides, 3, 12), borderRadius: number(data.borderRadius, 0, 100), color: color(data.color),
        } : type === 'link' ? { title: text(data.title, 160), description: text(data.description, 500), url: url(data.url), imageUrl: url(data.imageUrl) }
          : type === 'media' ? { label: text(data.label, 160), mediaType: ['image', 'video'].includes(String(data.type)) ? data.type : 'image', url: url(data.url) }
            : type === 'document' ? { filename: text(data.filename, 160), extension: text(data.extension, 20), size: text(data.size, 40) }
              : type === 'audio' ? { title: text(data.title, 160), mediaType: ['music', 'voice'].includes(String(data.type)) ? data.type : 'music', url: url(data.url) } : {};
        return clean({ ...common, ...specific });
      }),
      edges: edges.filter(edge => edge.hidden !== true && publicNodeId.has(edge.source) && publicNodeId.has(edge.target)).map((edge, index) => clean({
        id: `e${index}`, source: publicNodeId.get(edge.source), target: publicNodeId.get(edge.target),
        relationId: edge.data?.relationId, label: text(edge.data?.label, 160),
        offsetX: number((edge.data?.offset as { x?: unknown } | undefined)?.x, -10000, 10000),
        offsetY: number((edge.data?.offset as { y?: unknown } | undefined)?.y, -10000, 10000),
        sourceHandle: text(edge.sourceHandle, 40), targetHandle: text(edge.targetHandle, 40),
      })),
    };
    const projection = { diagramName: diagram.name, revision: diagram.revision, resources: publicResources, layout,
      relations: relationKeys.map(id => { const row = relationById.get(id)!; return {
        id: row.id, sourceResourceId: row.sourceResourceId, targetResourceId: row.targetResourceId,
        direction: row.direction, typeKey: row.typeKey, label: row.label ?? null, explanation: row.explanation ?? null,
        evidence: evidenceRows.filter(item => item.relationId === id && ids.includes(item.resourceId)).map(item => ({ resourceId: item.resourceId, excerpt: item.excerpt ?? null, note: item.note ?? null, pageNumber: item.pageNumber ?? null })),
      }; }) };
    const fingerprint = createHash('sha256').update(JSON.stringify({ projection, versions: ids.map(id => resourceById.get(id)!.versionId) })).digest('hex');
    return { ...projection, fingerprint, warnings, ready: warnings.length === 0 };
  }
}
