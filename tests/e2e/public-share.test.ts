import { NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it, vi } from 'vitest';
import { DiagramsController } from '../../src/interfaces/http/diagrams.controller.js';
import { PublicSharesController } from '../../src/interfaces/http/public-shares.controller.js';

describe('frontera pública de Compartidos', () => {
  it('deja la lectura sin guard y mantiene la publicación autenticada', async () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, PublicSharesController)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, DiagramsController)).toHaveLength(1);
    const header = vi.fn();
    const shares = { getPublicMedia: vi.fn(async () => ({ content: (async function* () { yield Buffer.from('public'); })(), mediaType: 'image/png', filename: 'imagen.png' })), getPublic: vi.fn(async (token: string) => {
      if (token === 'invalid') throw new NotFoundException('Compartido no encontrado.');
      return { diagramName: 'Mapa', revision: 1, resources: [], relations: [] };
    }) };
    const controller = new PublicSharesController(shares as never);
    await expect(controller.get('valid', { header })).resolves.toEqual({ data: { diagramName: 'Mapa', revision: 1, resources: [], relations: [] } });
    expect(header).toHaveBeenCalledWith('Cache-Control', 'no-store, max-age=0');
    await controller.media('valid', '11111111-1111-4111-8111-111111111111', { header });
    expect(shares.getPublicMedia).toHaveBeenCalledWith('valid', '11111111-1111-4111-8111-111111111111');
    expect(header).toHaveBeenCalledWith('Content-Disposition', "inline; filename*=UTF-8''imagen.png");
    expect(header).toHaveBeenCalledWith('Cross-Origin-Resource-Policy', 'cross-origin');
    expect(header).toHaveBeenCalledWith('Referrer-Policy', 'no-referrer');
    await expect(controller.get('invalid', { header })).rejects.toBeInstanceOf(NotFoundException);
    expect(header).toHaveBeenCalledWith('Cache-Control', 'no-store, max-age=0');
  });
});
