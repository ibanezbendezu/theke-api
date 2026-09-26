import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { Database } from '../../infrastructure/database/database.js';
import { resourceAccessibility, resourceLinks, resources, resourceVersions } from '../../infrastructure/database/schema.js';
import { DiagramService } from '../diagrams/diagram.service.js';
import { AiService } from './ai.service.js';

type CanvasNode = { id: string; type?: string; parentId?: string; data?: { resourceId?: unknown } };
export type ScopePreparation = { resourceIds: string[]; excluded: { nodeId: string; reason: string }[]; limitations: string[]; available: false; reason: 'PROVIDER_PENDING' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ScopePreparationService {
  constructor(@Inject(Database) private readonly database: Database, @Inject(DiagramService) private readonly diagrams: DiagramService, @Inject(AiService) private readonly ai: AiService) {}

  async group(accountId: string, input: { diagramId: string; groupId: string }): Promise<ScopePreparation> {
    if (!input || typeof input.diagramId !== 'string' || !uuid.test(input.diagramId) || typeof input.groupId !== 'string' || !input.groupId || input.groupId.length > 120) throw new BadRequestException('Grupo o Diagrama inválido.');
    const diagram = await this.diagrams.get(accountId, input.diagramId);
    if (diagram.archivedAt) throw new BadRequestException('El Diagrama está archivado.');
    const nodes = diagram.document.nodes as CanvasNode[];
    if (!nodes.some(node => node.id === input.groupId && node.type === 'container')) throw new NotFoundException('Grupo no encontrado en este Diagrama.');
    return this.assess(accountId, nodes.filter(node => node.parentId === input.groupId));
  }

  async review(accountId: string, input: { diagramId: string; nodeIds?: string[] }): Promise<ScopePreparation> {
    if (!input || typeof input.diagramId !== 'string' || !uuid.test(input.diagramId) || input.nodeIds !== undefined && (!Array.isArray(input.nodeIds) || input.nodeIds.length > 1000 || input.nodeIds.some(id => typeof id !== 'string' || !id || id.length > 120))) throw new BadRequestException('Selección o Diagrama inválido.');
    const diagram = await this.diagrams.get(accountId, input.diagramId);
    if (diagram.archivedAt) throw new BadRequestException('El Diagrama está archivado.');
    const nodes = diagram.document.nodes as CanvasNode[];
    if (input.nodeIds) {
      const available = new Set(nodes.map(node => node.id));
      if (input.nodeIds.some(id => !available.has(id))) throw new BadRequestException('La selección contiene nodos fuera del Diagrama guardado.');
      const selected = new Set(input.nodeIds);
      return this.assess(accountId, nodes.filter(node => selected.has(node.id)));
    }
    return this.assess(accountId, nodes);
  }

  async assess(accountId: string, nodes: CanvasNode[]): Promise<ScopePreparation> {
    const excluded: ScopePreparation['excluded'] = [];
    const candidates: { nodeId: string; resourceId: string }[] = [];
    const seen = new Set<string>();
    for (const node of nodes) {
      if (!node || typeof node.id !== 'string') continue;
      const resourceId = node.data?.resourceId;
      if (node.type !== 'resource' || typeof resourceId !== 'string' || !uuid.test(resourceId)) {
        excluded.push({ nodeId: node.id, reason: 'Representación sin Recurso analizable.' });
      } else if (seen.has(resourceId)) {
        excluded.push({ nodeId: node.id, reason: 'Recurso repetido en el alcance.' });
      } else {
        seen.add(resourceId);
        candidates.push({ nodeId: node.id, resourceId });
      }
    }
    const ids = candidates.map(item => item.resourceId);
    const rows = ids.length ? await this.database.db.select({ id: resources.id, type: resources.type, content: resourceVersions.content, accessibilityText: resourceAccessibility.text, linkMetadataStatus: resourceLinks.metadataStatus })
      .from(resources)
      .leftJoin(resourceVersions, and(eq(resources.currentVersionId, resourceVersions.id), eq(resources.id, resourceVersions.resourceId)))
      .leftJoin(resourceAccessibility, eq(resources.id, resourceAccessibility.resourceId))
      .leftJoin(resourceLinks, eq(resources.id, resourceLinks.resourceId))
      .where(and(eq(resources.accountId, accountId), inArray(resources.id, ids), isNull(resources.deletedAt), isNull(resources.archivedAt))) : [];
    const owned = new Map(rows.map(row => [row.id, row]));
    const maxTokens = (await this.ai.getStatus(accountId)).quota.maxInputTokens;
    const resourceIds: string[] = [];
    const limitations: string[] = [];
    let tokens = 0;
    for (const { nodeId, resourceId } of candidates) {
      const row = owned.get(resourceId);
      const content = row?.type === 'note' ? row.content : row?.accessibilityText;
      const estimated = 50 + Math.ceil((content?.length ?? 0) / 3.5);
      const reason = !row ? 'Recurso no disponible en esta Cuenta.' : !content?.trim() || row.type === 'link' && row.linkMetadataStatus === 'failed' ? 'Sin texto accesible para análisis.' : resourceIds.length >= 100 || tokens + estimated > maxTokens ? 'Límite de recursos o tokens superado.' : '';
      if (reason) excluded.push({ nodeId, reason });
      else { resourceIds.push(resourceId); tokens += estimated; }
    }
    if (!nodes.length) limitations.push('El alcance está vacío.');
    if (excluded.length) limitations.push('Algunos miembros no son analizables o se repiten.');
    if (tokens >= maxTokens) limitations.push('Se alcanzó el límite de tokens de entrada.');
    return { resourceIds, excluded, limitations, available: false, reason: 'PROVIDER_PENDING' };
  }
}