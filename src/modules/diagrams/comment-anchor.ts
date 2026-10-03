import type { PublicCommentAnchor, diagramShares } from '../../infrastructure/database/schema.js';

type Projection = typeof diagramShares.$inferSelect.projection;

export function commentHasAnchor(anchor: PublicCommentAnchor, projection: Projection): boolean {
  if (typeof anchor.x !== 'number' || !Number.isFinite(anchor.x) ||
      typeof anchor.y !== 'number' || !Number.isFinite(anchor.y)) return false;
  if (anchor.type === 'diagram') return Boolean(projection.layout?.nodes.length);
  if (anchor.type === 'resource') return projection.resources.some(item => item && typeof item === 'object' && 'id' in item && item.id === anchor.resourceId) &&
    Boolean(projection.layout?.nodes.some(node => node.resourceId === anchor.resourceId));
  return projection.relations.some(item => item && typeof item === 'object' && 'id' in item && item.id === anchor.relationId) &&
    Boolean(projection.layout?.edges.some(edge => edge.relationId === anchor.relationId));
}
