import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { Database } from '../src/infrastructure/database/database.js';
import { accounts, commentModerationEvents, commentNotifications, diagramShareEvents, diagramShares, diagrams, projects, publicShareComments, publicShareCommentMutations, users } from '../src/infrastructure/database/schema.js';
import { PublicCommentsService } from '../src/modules/diagrams/public-comments.service.js';
import { CommentNotificationsService } from '../src/modules/diagrams/comment-notifications.service.js';
import { DiagramShareService } from '../src/modules/diagrams/diagram-share.service.js';
import type { SharePreviewService } from '../src/modules/diagrams/share-preview.service.js';
import type { UploadStorage } from '../src/modules/uploads/upload.ports.js';

describe.runIf(Boolean(process.env.DATABASE_URL))('identidad anónima de comentarios con PostgreSQL', () => {
  const database = new Database();
  const comments = new PublicCommentsService(database);
  const notifications = new CommentNotificationsService(database);
  const previousSecret = process.env.SHARE_TOKEN_SECRET;
  const tokens = [randomBytes(32).toString('base64url'), randomBytes(32).toString('base64url')];
  let userId = ''; let accountId = ''; const projectIds: string[] = []; const diagramIds: string[] = []; const shareIds: string[] = [];
  const cookieValue = (setCookie: string) => setCookie.split(';')[0]!;

  afterAll(async () => {
    if (shareIds.length) { await database.db.delete(publicShareCommentMutations).where(inArray(publicShareCommentMutations.shareId, shareIds)); await database.db.delete(commentNotifications).where(eq(commentNotifications.accountId, accountId)); await database.db.delete(publicShareComments).where(inArray(publicShareComments.shareId, shareIds)); await database.db.delete(diagramShareEvents).where(inArray(diagramShareEvents.shareId, shareIds)); await database.db.delete(diagramShares).where(inArray(diagramShares.id, shareIds)); }
    if (diagramIds.length) await database.db.delete(diagrams).where(inArray(diagrams.id, diagramIds));
    if (projectIds.length) await database.db.delete(projects).where(inArray(projects.id, projectIds));
    if (accountId) { await database.db.delete(commentModerationEvents).where(eq(commentModerationEvents.accountId, accountId)); await database.db.delete(accounts).where(eq(accounts.id, accountId)); }
    if (userId) await database.db.delete(users).where(eq(users.id, userId));
    if (previousSecret === undefined) delete process.env.SHARE_TOKEN_SECRET; else process.env.SHARE_TOKEN_SECRET = previousSecret;
    await database.onModuleDestroy();
  });

  it('crea la identidad con el primer comentario, aísla Compartidos y exige la cookie y CSRF', async () => {
    process.env.SHARE_TOKEN_SECRET = 'integration-only-share-secret-at-least-32-bytes';
    const [user] = await database.db.insert(users).values({ clerkUserId: `comment_test_${randomUUID()}` }).returning(); userId = user!.id;
    const [account] = await database.db.insert(accounts).values({ personalOwnerUserId: userId, name: 'Comentarios de prueba' }).returning(); accountId = account!.id;
    for (const token of tokens) {
      const [project] = await database.db.insert(projects).values({ accountId, name: 'Mapa de prueba' }).returning(); projectIds.push(project!.id);
      const [diagram] = await database.db.insert(diagrams).values({ projectId: project!.id, name: 'Mapa', document: { schemaVersion: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } }).returning(); diagramIds.push(diagram!.id);
      const [share] = await database.db.insert(diagramShares).values({ accountId, diagramId: diagram!.id, tokenHash: createHash('sha256').update(token).digest('hex'), idempotencyKey: randomUUID(), fingerprint: 'a'.repeat(64), projection: { diagramName: 'Mapa', revision: 0, resources: [], relations: [] } }).returning(); shareIds.push(share!.id);
    }
    const [firstToken, secondToken] = tokens as [string, string];
    expect(await comments.list(firstToken)).toMatchObject({ identity: null, csrfToken: null, comments: [] });
    await expect(comments.create(firstToken, { content: ' ' }, undefined, undefined, '127.0.0.1')).rejects.toMatchObject({ status: 400 });
    expect((await comments.list(firstToken)).comments).toHaveLength(0);
    const first = await comments.create(firstToken, { content: 'Primero' }, undefined, undefined, '127.0.0.1');
    const pending = await notifications.list(accountId, {filter: 'pending'});
    expect(pending).toMatchObject({unreadCount: 1, items: [{commentId: first.comment.id, diagramId: diagramIds[0], projectId: projectIds[0], anchored: false}]});
    await expect(notifications.markRead(randomUUID(), pending.items[0]!.id)).rejects.toMatchObject({status: 404});
    await notifications.markRead(accountId, pending.items[0]!.id);
    expect((await notifications.list(accountId, {filter: 'pending'})).unreadCount).toBe(0);
    expect(first.comment).toMatchObject({ displayName: expect.stringMatching(/^[A-Z][a-z]+ [a-z]+$/), content: 'Primero', editable: true });
    expect(first.session).toBeTruthy();
    const cookie = cookieValue(comments.cookieHeader(first.session!));
    expect(comments.cookieHeader(first.session!)).toContain('Max-Age=2592000; Path=/; Secure; HttpOnly; SameSite=Lax');
    const recognized = await comments.list(firstToken, cookie);
    expect(recognized.identity).toEqual({ displayName: first.comment.displayName });
    expect(recognized.comments[0]).toMatchObject({ id: first.comment.id, editable: true });
    await expect(comments.create(firstToken, { content: 'Sin CSRF' }, cookie, undefined, '127.0.0.1')).rejects.toMatchObject({ status: 403 });
    const second = await comments.create(firstToken, { content: 'Segundo' }, cookie, recognized.csrfToken!, '127.0.0.1');
    expect(second).toMatchObject({ session: null, comment: { displayName: first.comment.displayName } });
    const edited = await comments.edit(firstToken, first.comment.id, { content: 'Primero corregido', expectedRevision: 1 }, cookie, recognized.csrfToken!, '127.0.0.1');
    expect(edited).toMatchObject({ id: first.comment.id, content: 'Primero corregido', revision: 2, anchor: first.comment.anchor });
    expect(edited.editedAt).toBeTruthy();
    await expect(comments.edit(firstToken, first.comment.id, { content: 'Borrador obsoleto', expectedRevision: 1 }, cookie, recognized.csrfToken!, '127.0.0.1'))
      .rejects.toMatchObject({ status: 409, response: { details: { current: { content: 'Primero corregido', revision: 2 } } } });
    expect((await comments.list(firstToken, cookie)).comments.find(item => item.id === first.comment.id)).toMatchObject({ content: 'Primero corregido', revision: 2, editable: true });
    expect(await comments.list(secondToken, cookie)).toMatchObject({ identity: null, comments: [] });
    const otherShare = await comments.create(secondToken, { displayName: 'Otro nombre', content: 'Otro mapa' }, cookie, (await comments.list(secondToken, cookie)).csrfToken!, '127.0.0.2');
    expect(otherShare.session).toBeNull();
    expect((await comments.list(secondToken, cookie)).identity).toEqual({ displayName: otherShare.comment.displayName });
    const lost = await comments.list(firstToken);
    expect(lost).toMatchObject({ identity: null });
    expect(lost.comments[0]).toMatchObject({ editable: false });
    const expiredAt = String(Math.floor(Date.now() / 1000) - 31 * 24 * 60 * 60);
    const nonce = randomBytes(32).toString('base64url');
    const expiredSignature = createHmac('sha256', process.env.SHARE_TOKEN_SECRET!).update(`comment:v1:${expiredAt}:${nonce}`).digest('base64url');
    const expiredCookie = `__Host-theke-comment=v1.${expiredAt}.${nonce}.${expiredSignature}`;
    expect((await comments.list(firstToken, expiredCookie)).identity).toBeNull();
    await expect(comments.edit(firstToken, first.comment.id, { content: 'Sin identidad', expectedRevision: 2 }, expiredCookie, undefined, '127.0.0.3')).rejects.toMatchObject({ status: 403 });
    const repeatedName = await comments.create(firstToken, { displayName: 'Ana Sol', content: 'Nueva identidad' }, expiredCookie, undefined, '127.0.0.3');
    expect(repeatedName.session).toBeTruthy();
    expect((await comments.list(firstToken, cookie)).comments.find(item => item.id === repeatedName.comment.id)?.editable).toBe(false);
    const resourceId = randomUUID(); const secondResourceId = randomUUID(); const relationId = randomUUID();
    await database.db.update(diagramShares).set({ projection: { diagramName: 'Mapa', revision: 1,
      resources: [{ id: resourceId, title: 'Fuente visible' }, { id: secondResourceId, title: 'Destino visible' }],
      relations: [{ id: relationId, label: 'Sustenta', sourceResourceId: resourceId, targetResourceId: secondResourceId }],
      layout: { nodes: [{ resourceId, x: 10, y: 20, width: 100, height: 60 }, { resourceId: secondResourceId, x: 210, y: 120, width: 100, height: 60 }], edges: [] },
    } }).where(eq(diagramShares.id, shareIds[0]!));
    const newCookie = cookieValue(comments.cookieHeader(repeatedName.session!));
    const csrf = (await comments.list(firstToken, newCookie)).csrfToken!;
    await expect(comments.edit(firstToken, first.comment.id, { content: 'Intento ajeno', expectedRevision: 2 }, newCookie, csrf, '127.0.0.3')).rejects.toMatchObject({ status: 404 });
    await expect(comments.create(firstToken, { content: 'No publicada', anchor: { type: 'resource', resourceId: randomUUID() } }, newCookie, csrf, '127.0.0.3')).rejects.toMatchObject({ status: 404 });
    await expect(comments.create(firstToken, { content: 'No publicada', anchor: { type: 'diagram', x: Infinity, y: 1 } }, newCookie, csrf, '127.0.0.3')).rejects.toMatchObject({ status: 400 });
    const onResource = await comments.create(firstToken, { content: 'Sobre la fuente', anchor: { type: 'resource', resourceId } }, newCookie, csrf, '127.0.0.3');
    expect(onResource.comment.anchor).toEqual({ type: 'resource', resourceId, label: 'Fuente visible', x: 60, y: 50 });
    const onRelation = await comments.create(firstToken, { content: 'Sobre la relación', anchor: { type: 'relation', relationId } }, newCookie, csrf, '127.0.0.3');
    expect(onRelation.comment.anchor).toEqual({ type: 'relation', relationId, label: 'Sustenta', x: 160, y: 100 });
    const onPoint = await comments.create(firstToken, { content: 'En este punto', anchor: { type: 'diagram', x: 25, y: -50 } }, newCookie, csrf, '127.0.0.3');
    expect(onPoint.comment.anchor).toEqual({ type: 'diagram', x: 25, y: -50 });
    await comments.create(firstToken, { content: 'Quinto comentario' }, newCookie, csrf, '127.0.0.3');
    await expect(comments.create(firstToken, { content: 'Supera el límite' }, newCookie, csrf, '127.0.0.3')).rejects.toMatchObject({ status: 429 });
    await database.db.update(publicShareComments).set({ deletedAt: new Date() }).where(eq(publicShareComments.id, first.comment.id));
    await expect(comments.edit(firstToken, first.comment.id, { content: 'Comentario eliminado', expectedRevision: 2 }, cookie, recognized.csrfToken!, '127.0.0.1')).rejects.toMatchObject({ status: 404 });
    await database.db.update(publicShareComments).set({ deletedAt: null }).where(eq(publicShareComments.id, first.comment.id));
    await database.db.update(diagramShares).set({ commentsEnabled: false }).where(eq(diagramShares.id, shareIds[0]!));
    await expect(comments.create(firstToken, { content: 'Bloqueado' }, cookie, recognized.csrfToken!, '127.0.0.1')).rejects.toMatchObject({ status: 409 });
    await expect(comments.edit(firstToken, first.comment.id, { content: 'Edición bloqueada', expectedRevision: 2 }, cookie, recognized.csrfToken!, '127.0.0.1')).rejects.toMatchObject({ status: 409 });
    expect((await comments.list(firstToken)).comments).toHaveLength(7);
    await database.db.update(diagramShares).set({ commentsEnabled: true }).where(eq(diagramShares.id, shareIds[0]!));
    await expect(comments.claim(firstToken, cookie, 'wrong-csrf', { id: userId, displayName: 'Investigadora' })).rejects.toMatchObject({ status: 403 });
    expect(await comments.claim(firstToken, cookie, recognized.csrfToken!, { id: userId, displayName: 'Investigadora' })).toEqual({ claimed: 2 });
    expect(await comments.claim(firstToken, cookie, recognized.csrfToken!, { id: randomUUID(), displayName: 'Otra persona' })).toEqual({ claimed: 0 });
    expect((await comments.list(firstToken, cookie)).comments.find(item => item.id === first.comment.id)).toMatchObject({ displayName: 'Investigadora', editable: false });
    expect((await comments.list(firstToken, undefined, { id: userId, displayName: 'Investigadora' })).comments.find(item => item.id === first.comment.id)).toMatchObject({ displayName: 'Investigadora', editable: true });
    await expect(comments.edit(firstToken, first.comment.id, { content: 'Ya firmado', expectedRevision: 2 }, cookie, recognized.csrfToken!, '127.0.0.1')).rejects.toMatchObject({ status: 404 });
    expect(await comments.edit(firstToken, first.comment.id, { content: 'Ya firmado', expectedRevision: 2 }, undefined, undefined, '127.0.0.1', { id: userId, displayName: 'Investigadora' })).toMatchObject({ content: 'Ya firmado', revision: 3 });
    const item = (await notifications.list(accountId, { commentId: onPoint.comment.id })).items[0]!;
    await expect(notifications.moderate(randomUUID(), userId, item.id, 'resolve')).rejects.toMatchObject({ status: 404 });
    await notifications.moderate(accountId, userId, item.id, 'resolve');
    expect((await notifications.list(accountId, { filter: 'resolved' })).items.some(row => row.commentId === onPoint.comment.id)).toBe(true);
    expect((await comments.list(firstToken)).comments.find(row => row.id === onPoint.comment.id)?.content).toBe('En este punto');
    await notifications.moderate(accountId, userId, item.id, 'reopen');
    expect((await notifications.list(accountId, { filter: 'pending' })).items.some(row => row.commentId === onPoint.comment.id)).toBe(true);
    await notifications.moderate(accountId, userId, item.id, 'delete');
    expect((await comments.list(firstToken)).comments.some(row => row.id === onPoint.comment.id)).toBe(false);
    expect((await notifications.list(accountId, { commentId: onPoint.comment.id })).items).toHaveLength(0);
    const [removed] = await database.db.select({ purgeAfter: publicShareComments.purgeAfter }).from(publicShareComments).where(eq(publicShareComments.id, onPoint.comment.id));
    expect(removed?.purgeAfter).toBeInstanceOf(Date);
    await database.db.update(publicShareComments).set({ purgeAfter: new Date(Date.now() - 1000) }).where(eq(publicShareComments.id, onPoint.comment.id));
    expect(await notifications.purgeExpired()).toBeGreaterThan(0);
    expect((await database.db.select({ id: publicShareComments.id }).from(publicShareComments).where(eq(publicShareComments.id, onPoint.comment.id)))).toHaveLength(0);
    const refreshed = new DiagramShareService(database, { get: async () => ({ ready: true, fingerprint: 'b'.repeat(64), diagramName: 'Mapa', revision: 2,
      resources: [], relations: [], layout: { nodes: [], edges: [] } }) } as unknown as SharePreviewService, {} as UploadStorage);
    await refreshed.refresh(accountId, userId, diagramIds[0]!, { fingerprint: 'b'.repeat(64), expectedPublishedFingerprint: 'a'.repeat(64) });
    const orphan = (await comments.list(firstToken)).comments.find(row => row.id === onResource.comment.id);
    expect(orphan).toMatchObject({ anchored: false, content: 'Sobre la fuente', anchor: { label: 'Fuente visible' } });
    expect((await notifications.list(accountId, { filter: 'unanchored' })).items.some(row => row.commentId === onResource.comment.id)).toBe(true);
    await database.db.insert(publicShareComments).values(Array.from({ length: 101 }, (_, index) => ({
      shareId: shareIds[0]!, ownerHash: 'pagination-fixture', ipHash: 'pagination-fixture', displayName: 'Prueba',
      content: `Página ${index}`, createdAt: new Date(Date.now() + (index + 1) * 1000),
    })));
    const firstPage = await comments.list(firstToken);
    expect(firstPage.comments).toHaveLength(100);
    expect(firstPage.nextCursor).toBe(firstPage.comments[99]?.id);
    const secondPage = await comments.list(firstToken, undefined, undefined, firstPage.nextCursor!);
    expect(secondPage.comments.length).toBeGreaterThan(0);
    expect(secondPage.comments.some(row => row.id === firstPage.comments[99]?.id)).toBe(false);
    expect(secondPage.comments.some(row => row.content === 'Primero corregido' || row.content === 'Ya firmado')).toBe(true);
    await expect(comments.list(firstToken, undefined, undefined, 'bad-cursor')).rejects.toMatchObject({status: 400});
    await database.db.update(diagramShares).set({ revokedAt: new Date() }).where(eq(diagramShares.id, shareIds[0]!));
    await expect(comments.list(firstToken)).rejects.toMatchObject({ status: 404 });
  }, 120_000);
});
