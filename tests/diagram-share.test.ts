import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiagramShareService } from '../src/modules/diagrams/diagram-share.service.js';

const fingerprint = 'a'.repeat(64);
const projection = { diagramName: 'Mapa', revision: 7, resources: [{ id: 'visible', title: 'Visible' }], relations: [] };

function setup(options: { owned?: boolean; ready?: boolean; fingerprint?: string; prior?: { diagramId: string; fingerprint: string; tokenHash: string; revokedAt: Date | null }; active?: boolean } = {}) {
  const rows = [options.owned === false ? [] : [{ id: 'diagram' }], options.prior ? [{ id: 'share', ...options.prior }] : [], options.active ? [{ id: 'share' }] : []];
  const select = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    for (const key of ['from', 'innerJoin', 'where', 'for']) chain[key] = vi.fn(() => chain);
    chain.limit = vi.fn(async () => rows.shift() ?? []);
    return chain;
  });
  const insert = vi.fn(() => ({ values: vi.fn(async () => undefined) }));
  const tx = { select, insert };
  const transaction = vi.fn(async (callback: (tx: typeof tx) => Promise<unknown>, config: unknown) => {
    expect(config).toEqual({ isolationLevel: 'serializable' });
    return callback(tx);
  });
  const database = { db: { transaction, select } };
  const preview = { get: vi.fn(async () => ({ ...projection, ready: options.ready ?? true, fingerprint: options.fingerprint ?? fingerprint, warnings: [], privateData: 'must-not-persist' })) };
  return { service: new DiagramShareService(database as never, preview as never, { read: vi.fn() } as never), preview, tx, insert, transaction, select };
}

describe('publicación de Compartidos', () => {
  beforeEach(() => { process.env.SHARE_TOKEN_SECRET = 'a-production-secret-must-be-unpredictable-and-long'; });
  afterEach(() => { delete process.env.SHARE_TOKEN_SECRET; });

  it('rechaza huellas y claves inválidas sin abrir transacción', async () => {
    const { service, transaction } = setup();
    await expect(service.publish('owner', 'actor', 'diagram', { fingerprint: 'bad', idempotencyKey: 'key' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.publish('owner', 'actor', 'diagram', { fingerprint, idempotencyKey: '' })).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('no publica cuando falta el secreto criptográfico', async () => {
    const { service, transaction } = setup();
    delete process.env.SHARE_TOKEN_SECRET;
    await expect(service.publish('owner', 'actor', 'diagram', { fingerprint, idempotencyKey: 'key' })).rejects.toThrow('SHARE_TOKEN_SECRET');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('no publica para otra cuenta ni consulta la proyección', async () => {
    const { service, preview, insert } = setup({ owned: false });
    await expect(service.publish('stranger', 'actor', 'diagram', { fingerprint, idempotencyKey: 'key' })).rejects.toBeInstanceOf(NotFoundException);
    expect(preview.get).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it.each([{ fingerprint: 'b'.repeat(64) }, { ready: false }])('falla cerrado ante una vista previa obsoleta o no lista', async options => {
    const { service, insert, preview, tx } = setup(options);
    await expect(service.publish('owner', 'actor', 'diagram', { fingerprint, idempotencyKey: 'key' })).rejects.toBeInstanceOf(ConflictException);
    expect(preview.get).toHaveBeenCalledWith('owner', 'diagram', tx);
    expect(insert).not.toHaveBeenCalled();
  });

  it('guarda solo la proyección allowlist y el hash; el reintento devuelve el mismo enlace', async () => {
    const { service, insert } = setup();
    const result = await service.publish('owner', 'actor', 'diagram', { fingerprint, idempotencyKey: 'key' });
    expect(result).toEqual({ url: `/share/${result.token}`, token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    const values = (insert.mock.results[0]!.value as { values: ReturnType<typeof vi.fn> }).values.mock.calls[0]![0];
    expect(values).toMatchObject({ accountId: 'owner', diagramId: 'diagram', fingerprint, tokenHash: createHash('sha256').update(result.token).digest('hex'), projection, mediaManifest: {} });
    expect(JSON.stringify(values)).not.toContain('privateData');
    expect(JSON.stringify(values)).not.toContain(result.token);
    const event = (insert.mock.results[1]!.value as { values: ReturnType<typeof vi.fn> }).values.mock.calls[0]![0];
    expect(event).toMatchObject({ shareId: values.id, actorUserId: 'actor', action: 'published' });
    expect(JSON.stringify(event)).not.toContain(result.token);
    const retry = setup({ prior: { diagramId: 'diagram', fingerprint, tokenHash: createHash('sha256').update(result.token).digest('hex'), revokedAt: null } });
    expect(await retry.service.publish('owner', 'actor', 'diagram', { fingerprint, idempotencyKey: 'key' })).toEqual(result);
    expect((retry.insert.mock.results[0]!.value as { values: ReturnType<typeof vi.fn> }).values.mock.calls[0]![0]).toMatchObject({ shareId: 'share', actorUserId: 'actor', action: 'retried' });
  });

  it('rechaza la reutilización incompatible, los revocados y otro compartido activo', async () => {
    const tokenHash = createHash('sha256').update('other-token').digest('hex');
    for (const options of [{ prior: { diagramId: 'other', fingerprint, tokenHash, revokedAt: null } }, { prior: { diagramId: 'diagram', fingerprint: 'b'.repeat(64), tokenHash, revokedAt: null } }, { prior: { diagramId: 'diagram', fingerprint, tokenHash, revokedAt: new Date() } }, { prior: { diagramId: 'diagram', fingerprint, tokenHash, revokedAt: null } }, { active: true }]) {
      const { service, insert } = setup(options);
      await expect(service.publish('owner', 'actor', 'diagram', { fingerprint, idempotencyKey: 'key' })).rejects.toBeInstanceOf(ConflictException);
      expect(insert).not.toHaveBeenCalled();
    }
  });

  it('devuelve una respuesta pública neutra y sin metadatos privados', async () => {
    const token = 'a'.repeat(43);
    const { service, select } = setup();
    await expect(service.getPublic('bad')).rejects.toBeInstanceOf(NotFoundException);
    expect(select).not.toHaveBeenCalled();
    const query = vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => [{ projection: { ...projection, accountId: 'private', warnings: ['secret'] } }]) })) })) }));
    const publicService = new DiagramShareService({ db: { select: query } } as never, {} as never, { read: vi.fn() } as never);
    expect(await publicService.getPublic(token)).toEqual({ ...projection, layout: { nodes: [], edges: [] }, commentsEnabled: undefined });
    expect(query).toHaveBeenCalledTimes(1);
    const missing = new DiagramShareService({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) } } as never, {} as never, { read: vi.fn() } as never);
    await expect(missing.getPublic(token)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('recupera el nombre de tipos personalizados en compartidos anteriores', async () => {
    const token = 'a'.repeat(43);
    const typeId = '44444444-4444-4444-8444-444444444444';
    const legacyRelation = { id: 'relation', typeKey: `custom:${typeId}`, label: null };
    const limit = vi.fn(async () => [{ accountId: 'owner', projection: { ...projection, relations: [legacyRelation] }, commentsEnabled: true }]);
    const where = vi.fn(async () => [{ id: typeId, label: 'Contextualiza smoke' }]);
    const select = vi.fn().mockReturnValueOnce({ from: () => ({ where: () => ({ limit }) }) })
      .mockReturnValueOnce({ from: () => ({ where }) });
    const service = new DiagramShareService({ db: { select } } as never, {} as never, { read: vi.fn() } as never);
    expect((await service.getPublic(token)).relations).toEqual([{ ...legacyRelation, typeLabel: 'Contextualiza smoke' }]);
  });

  it('solo entrega bytes del archivo fijado y nunca la clave de almacenamiento', async () => {
    const token = 'a'.repeat(43); const resourceId = '11111111-1111-4111-8111-111111111111';
    const read = vi.fn(async () => (async function* () { yield Buffer.from('file'); })());
    const query = vi.fn(() => ({ from: () => ({ where: () => ({ limit: async () => [{ projection: { ...projection, resources: [{ id: resourceId, type: 'file', title: 'Imagen' }] }, mediaManifest: { [resourceId]: { versionId: 'version', storageKey: 'private/key', mediaType: 'image/png', filename: 'Imagen' } } }] }) }) }));
    const service = new DiagramShareService({ db: { select: query } } as never, {} as never, { read } as never);
    await expect(service.getPublicMedia(token, 'bad')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getPublicMedia(token, '22222222-2222-4222-8222-222222222222')).rejects.toBeInstanceOf(NotFoundException);
    const media = await service.getPublicMedia(token, resourceId);
    expect(media.mediaType).toBe('image/png'); expect(media.filename).toBe('Imagen');
    expect(read).toHaveBeenCalledWith('private/key');
    expect(Buffer.concat(await Array.fromAsync(media.content))).toEqual(Buffer.from('file'));
  });
});
