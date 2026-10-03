import { describe, expect, it } from 'vitest';
import { commentHasAnchor } from '../src/modules/diagrams/comment-anchor.js';

const resourceId = 'ab8b380b-1855-40cb-aa2f-ccf27167e4c9';
const relationId = '44a68738-7d03-4467-8a42-a0ed16f59bdf';
const projection = {
  diagramName: 'Mapa', revision: 1,
  resources: [{ id: resourceId, title: 'Fuente publicada' }],
  relations: [{ id: relationId, label: 'Conecta' }],
  layout: { nodes: [{ id: 'n1', resourceId }], edges: [{ id: 'e1', relationId }] },
};

describe('anclaje de comentarios en una proyección pública', () => {
  it('pierde el marcador si se retira la representación, aunque el recurso siga publicado', () => {
    const anchor = { type: 'resource' as const, resourceId, label: 'Fuente publicada', x: 12, y: 18 };
    expect(commentHasAnchor(anchor, projection)).toBe(true);
    expect(commentHasAnchor(anchor, { ...projection, layout: { ...projection.layout, nodes: [] } })).toBe(false);
    expect(commentHasAnchor(anchor, { ...projection, resources: [] })).toBe(false);
  });

  it('pierde el marcador si se retira la visualización de la relación', () => {
    const anchor = { type: 'relation' as const, relationId, label: 'Conecta', x: 18, y: 20 };
    expect(commentHasAnchor(anchor, projection)).toBe(true);
    expect(commentHasAnchor(anchor, { ...projection, layout: { ...projection.layout, edges: [] } })).toBe(false);
  });

  it('mantiene un punto solo mientras hay mapa y coordenadas válidas', () => {
    expect(commentHasAnchor({ type: 'diagram', x: 0, y: 0 }, projection)).toBe(true);
    expect(commentHasAnchor({ type: 'diagram' }, projection)).toBe(false);
    expect(commentHasAnchor({ type: 'diagram', x: 0, y: 0 }, { ...projection, layout: { nodes: [], edges: [] } })).toBe(false);
  });
});
