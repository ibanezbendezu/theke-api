import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { Database } from '../src/infrastructure/database/database.js';
import { accounts, diagramRevisions, diagramShareEvents, diagramShares, diagrams, memberships, projects, resourceAccessibility, resources, resourceVersions, users } from '../src/infrastructure/database/schema.js';
import { AccountService } from '../src/modules/account/account.service.js';
import { DiagramService } from '../src/modules/diagrams/diagram.service.js';
import { SharePreviewService } from '../src/modules/diagrams/share-preview.service.js';
import { DiagramShareService } from '../src/modules/diagrams/diagram-share.service.js';
import { ProjectService } from '../src/modules/projects/project.service.js';
import { NoteService } from '../src/modules/resources/note.service.js';
import { ResourceKnowledgeRepository } from '../src/modules/resources/resource-knowledge.repository.js';

describe.runIf(Boolean(process.env.DATABASE_URL))('Compartidos con PostgreSQL', () => {
  const database = new Database(); const accountsService = new AccountService(database); const projectsService = new ProjectService(database); const diagramsService = new DiagramService(database); const preview = new SharePreviewService(database, diagramsService); const notes = new NoteService(database, new ResourceKnowledgeRepository(database));
  const read = vi.fn(async (key: string) => (async function* () { yield Buffer.from(key); })());
  const shares = new DiagramShareService(database, preview, { read } as never);
  const previousSecret = process.env.SHARE_TOKEN_SECRET;
  const clerkId = `share_integration_${crypto.randomUUID()}`;
  let accountId = ''; let userId = ''; let projectId = ''; let diagramId = ''; const resourceIds: string[] = [];
  afterAll(async () => {
    if (diagramId) { await database.db.delete(diagramShareEvents).where(eq(diagramShareEvents.diagramId, diagramId)); await database.db.delete(diagramShares).where(eq(diagramShares.diagramId, diagramId)); await database.db.delete(diagramRevisions).where(eq(diagramRevisions.diagramId, diagramId)); await database.db.delete(diagrams).where(eq(diagrams.id, diagramId)); }
    if (projectId) await database.db.delete(projects).where(eq(projects.id, projectId));
    if (resourceIds.length) { await database.db.delete(resourceAccessibility).where(inArray(resourceAccessibility.resourceId, resourceIds)); await database.db.update(resources).set({ currentVersionId: null }).where(inArray(resources.id, resourceIds)); await database.db.delete(resourceVersions).where(inArray(resourceVersions.resourceId, resourceIds)); await database.db.delete(resources).where(inArray(resources.id, resourceIds)); }
    if (userId) { await database.db.delete(memberships).where(eq(memberships.userId, userId)); await database.db.delete(accounts).where(eq(accounts.id, accountId)); await database.db.delete(users).where(eq(users.id, userId)); }
    if (previousSecret === undefined) delete process.env.SHARE_TOKEN_SECRET; else process.env.SHARE_TOKEN_SECRET = previousSecret;
    await database.onModuleDestroy();
  }, 30_000);

  it('fija contenido y archivo, audita reintentos y no publica una vista previa obsoleta', async () => {
    process.env.SHARE_TOKEN_SECRET = 'integration-only-share-secret-at-least-32-bytes';
    const identity = await accountsService.ensureLocalUser({ clerkUserId: clerkId }); accountId = identity.account.id; userId = identity.user.id;
    const project = await projectsService.create(accountId, 'Publicación de prueba'); projectId = project.id;
    const note = await notes.create(accountId, userId, { title: 'Nota visible', content: 'Primera versión' }); resourceIds.push(note.id);
    const [file] = await database.db.insert(resources).values({ accountId, authorUserId: userId, type: 'file', title: 'Imagen visible', creationMethod: 'manual' }).returning(); resourceIds.push(file!.id);
    const [version] = await database.db.insert(resourceVersions).values({ resourceId: file!.id, authorUserId: userId, ordinal: 1, content: '', contentHash: 'file-hash', storageKey: 'private/original', mediaType: 'image/png', byteSize: 8 }).returning();
    await database.db.update(resources).set({ currentVersionId: version!.id }).where(eq(resources.id, file!.id));
    await database.db.insert(resourceAccessibility).values({ resourceId: file!.id, text: 'Imagen de prueba' });
    const diagram = await diagramsService.get(accountId, (await diagramsService.list(accountId, projectId, 'active'))[0]!.id); diagramId = diagram.id; await diagramsService.rename(accountId, diagramId, 'Mapa visible');
    const document = { schemaVersion: 1, nodes: [{ id: 'note', type: 'resource', position: { x: 0, y: 0 }, data: { resourceId: note.id } }, { id: 'file', type: 'resource', position: { x: 100, y: 0 }, data: { resourceId: file!.id } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
    await diagramsService.save(accountId, diagramId, { document, expectedRevision: 0, idempotencyKey: crypto.randomUUID() });
    const first = await preview.get(accountId, diagramId); expect(first.ready).toBe(true);
    await notes.update(accountId, userId, note.id, { title: 'Nota visible', content: 'Segunda versión' });
    await expect(shares.publish(accountId, userId, diagramId, { fingerprint: first.fingerprint, idempotencyKey: crypto.randomUUID() })).rejects.toThrow('cambió');
    const current = await preview.get(accountId, diagramId); const key = crypto.randomUUID();
    const published = await shares.publish(accountId, userId, diagramId, { fingerprint: current.fingerprint, idempotencyKey: key });
    expect(await shares.publish(accountId, userId, diagramId, { fingerprint: current.fingerprint, idempotencyKey: key })).toEqual(published);
    expect((await shares.getPublic(published.token)).resources).toEqual(current.resources);
    expect((await shares.getPublic(published.token)).layout).toEqual(current.layout);
    const media = await shares.getPublicMedia(published.token, file!.id);
    expect(Buffer.concat(await Array.fromAsync(media.content))).toEqual(Buffer.from('private/original'));
    expect(read).toHaveBeenCalledWith('private/original');
    const [stored] = await database.db.select().from(diagramShares).where(eq(diagramShares.diagramId, diagramId));
    expect(stored!.mediaManifest[file!.id]?.versionId).toBe(version!.id);
    expect(JSON.stringify(stored!.projection)).not.toContain('private/original');
    expect((await database.db.select().from(diagramShareEvents).where(eq(diagramShareEvents.shareId, stored!.id))).map(event => event.action).sort()).toEqual(['published', 'retried']);
    expect(await shares.manage(accountId, diagramId)).toMatchObject({ active: true, fingerprint: current.fingerprint, commentsEnabled: true });
    expect(await shares.setComments(accountId, userId, diagramId, { enabled: false })).toEqual({ commentsEnabled: false });
    expect((await shares.getPublic(published.token)).commentsEnabled).toBe(false);
    await notes.update(accountId, userId, note.id, { title: 'Nota visible', content: 'Tercera versión' });
    const [replacementVersion] = await database.db.insert(resourceVersions).values({ resourceId: file!.id, authorUserId: userId, ordinal: 2, content: '', contentHash: 'file-hash-2', storageKey: 'private/replacement', mediaType: 'image/png', byteSize: 12 }).returning();
    await database.db.update(resources).set({ currentVersionId: replacementVersion!.id }).where(eq(resources.id, file!.id));
    const next = await preview.get(accountId, diagramId);
    await expect(shares.refresh(accountId, userId, diagramId, { fingerprint: next.fingerprint, expectedPublishedFingerprint: 'b'.repeat(64) })).rejects.toThrow('cambió');
    expect((await shares.getPublic(published.token)).resources).toEqual(current.resources);
    expect(Buffer.concat(await Array.fromAsync((await shares.getPublicMedia(published.token, file!.id)).content))).toEqual(Buffer.from('private/original'));
    expect(await shares.refresh(accountId, userId, diagramId, { fingerprint: next.fingerprint, expectedPublishedFingerprint: current.fingerprint })).toEqual({ fingerprint: next.fingerprint, revision: next.revision });
    expect((await shares.getPublic(published.token)).resources).toEqual(next.resources);
    expect((await shares.getPublic(published.token)).layout).toEqual(next.layout);
    expect(Buffer.concat(await Array.fromAsync((await shares.getPublicMedia(published.token, file!.id)).content))).toEqual(Buffer.from('private/replacement'));
    await expect(shares.revoke(accountId, userId, diagramId, { expectedPublishedFingerprint: current.fingerprint, confirmation: 'REVOCAR' })).rejects.toThrow('cambió');
    expect(await shares.revoke(accountId, userId, diagramId, { expectedPublishedFingerprint: next.fingerprint, confirmation: 'REVOCAR' })).toEqual({ active: false });
    await expect(shares.getPublic(published.token)).rejects.toThrow('no encontrado');
    await expect(shares.getPublicMedia(published.token, file!.id)).rejects.toThrow('no encontrado');
    const replacement = await shares.publish(accountId, userId, diagramId, { fingerprint: next.fingerprint, idempotencyKey: crypto.randomUUID() });
    expect(replacement.token).not.toBe(published.token);
    expect((await shares.getPublic(replacement.token)).resources).toEqual(next.resources);
    expect((await database.db.select().from(diagramShareEvents).where(eq(diagramShareEvents.shareId, stored!.id))).map(event => event.action).sort())
      .toEqual(['comments_changed', 'published', 'refreshed', 'retried', 'revoked']);
    expect((await database.db.select().from(diagramShares).where(eq(diagramShares.diagramId, diagramId)))).toHaveLength(2);
  }, 60_000);
});
