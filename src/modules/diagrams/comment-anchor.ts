import type { PublicCommentAnchor, diagramShares } from '../../infrastructure/database/schema.js';

type Projection = typeof diagramShares.$inferSelect.projection;
type PublishedPosition = { x: number; y: number };

function validPoint<T extends { x?: unknown; y?: unknown }>(value: T): value is T & PublishedPosition {
  return typeof value.x === 'number' && Number.isFinite(value.x) &&
    typeof value.y === 'number' && Number.isFinite(value.y);
}

function hasPublishedId(items: unknown[], id: string) {
  return items.some(item => item !== null && typeof item === 'object' && 'id' in item && item.id === id);
}

function portPosition(node: Record<string, unknown> | undefined, port?: unknown) {
  if (!node || !validPoint(node)) return null;
  const width = typeof node.width === 'number' ? node.width : 288;
  const height = typeof node.height === 'number' ? node.height : 112;
  const x = port === 'left' ? 0 : port === 'right' ? width : width / 2;
  const y = port === 'top' ? 0 : port === 'bottom' ? height : height / 2;
  return { x: node.x + x, y: node.y + y };
}

export function publishedCommentPosition(anchor: PublicCommentAnchor, projection: Projection): PublishedPosition | null {
  const layout = projection.layout;
  if (!layout) return null;
  if (anchor.type === 'diagram') return layout.nodes.length && validPoint(anchor) ? { x: anchor.x, y: anchor.y } : null;
  if (anchor.type === 'resource') {
    if (!hasPublishedId(projection.resources, anchor.resourceId)) return null;
    return portPosition(layout.nodes.find(node => node.resourceId === anchor.resourceId));
  }
  if (!hasPublishedId(projection.relations, anchor.relationId)) return null;
  const edge = layout.edges.find(item => item.relationId === anchor.relationId);
  if (!edge) return null;
  const source = portPosition(layout.nodes.find(node => node.id === edge.source), edge.sourceHandle ?? 'right');
  const target = portPosition(layout.nodes.find(node => node.id === edge.target), edge.targetHandle ?? 'left');
  if (!source || !target) return null;
  // Midpoint of the public quadratic edge, whose control point is offset from its center.
  return {
    x: (source.x + target.x + (typeof edge.offsetX === 'number' ? edge.offsetX : 0)) / 2,
    y: (source.y + target.y + (typeof edge.offsetY === 'number' ? edge.offsetY : 0)) / 2,
  };
}

export function commentHasAnchor(anchor: PublicCommentAnchor, projection: Projection): boolean {
  if (typeof anchor.x !== 'number' || !Number.isFinite(anchor.x) ||
      typeof anchor.y !== 'number' || !Number.isFinite(anchor.y)) return false;
  if (anchor.type === 'diagram') return Boolean(projection.layout?.nodes.length);
  if (anchor.type === 'resource') return projection.resources.some(item => item && typeof item === 'object' && 'id' in item && item.id === anchor.resourceId) &&
    Boolean(projection.layout?.nodes.some(node => node.resourceId === anchor.resourceId));
  return projection.relations.some(item => item && typeof item === 'object' && 'id' in item && item.id === anchor.relationId) &&
    Boolean(projection.layout?.edges.some(edge => edge.relationId === anchor.relationId));
}
