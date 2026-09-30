import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { Database } from '../src/infrastructure/database/database.js';
import { accounts, diagramShares, diagrams, projects, publicShareComments, users } from '../src/infrastructure/database/schema.js';
import { PublicCommentsService } from '../src/modules/diagrams/public-comments.service.js';

describe.runIf(Boolean(process.env.DATABASE_URL))('identidad anónima de comentarios con PostgreSQL', () => {
  const database = new Database();
  const comments = new PublicCommentsService(database);
  const previousSecret = process.env.SHARE_TOKEN_SECRET;
  const tokens = [randomBytes(32).toString('base64url'), randomBytes(32).toString('base64url')];
  let userId = ''; let accountId = ''; const projectIds: string[] = []; const diagramIds: string[] = []; const shareIds: string[] = [];
  const cookieValue = (setCookie: string) => setCookie.split(';')[0]!;

  afterAll(async () => {
    if (shareIds.length) { await database.db.delete(publicShareComments).where(inArray(publicShareComments.shareId, shareIds)); await database.db.delete(diagramShares).where(inArray(diagramShares.id, shareIds)); }
    if (diagramIds.length) await database.db.delete(diagrams).where(inArray(diagrams.id, diagramIds));
    if (projectIds.length) await database.db.delete(projects).where(inArray(projects.id, projectIds));
    if (accountId) await database.db.delete(accounts).where(eq(accounts.id, accountId));
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
    await expect(comments.create(firstToken, { displayName: ' ', content: 'Borrador' }, undefined, undefined, '127.0.0.1')).rejects.toMatchObject({ status: 400 });
    expect((await comments.list(firstToken)).comments).toHaveLength(0);
    const first = await comments.create(firstToken, { displayName: '  Ana   Sol  ', content: 'Primero' }, undefined, undefined, '127.0.0.1');
    expect(first.comment).toMatchObject({ displayName: 'Ana Sol', content: 'Primero', editable: true });
    expect(first.session).toBeTruthy();
    const cookie = cookieValue(comments.cookieHeader(first.session!));
    expect(comments.cookieHeader(first.session!)).toContain('Max-Age=2592000; Path=/; Secure; HttpOnly; SameSite=Lax');
    const recognized = await comments.list(firstToken, cookie);
    expect(recognized.identity).toEqual({ displayName: 'Ana Sol' });
    expect(recognized.comments[0]).toMatchObject({ id: first.comment.id, editable: true });
    await expect(comments.create(firstToken, { content: 'Sin CSRF' }, cookie, undefined, '127.0.0.1')).rejects.toMatchObject({ status: 403 });
    const second = await comments.create(firstToken, { content: 'Segundo' }, cookie, recognized.csrfToken!, '127.0.0.1');
    expect(second).toMatchObject({ session: null, comment: { displayName: 'Ana Sol' } });
    expect(await comments.list(secondToken, cookie)).toMatchObject({ identity: null, comments: [] });
    const otherShare = await comments.create(secondToken, { displayName: 'Otro nombre', content: 'Otro mapa' }, cookie, (await comments.list(secondToken, cookie)).csrfToken!, '127.0.0.2');
    expect(otherShare.session).toBeNull();
    expect((await comments.list(secondToken, cookie)).identity).toEqual({ displayName: 'Otro nombre' });
    const lost = await comments.list(firstToken);
    expect(lost).toMatchObject({ identity: null });
    expect(lost.comments[0]).toMatchObject({ editable: false });
    const expiredAt = String(Math.floor(Date.now() / 1000) - 31 * 24 * 60 * 60);
    const nonce = randomBytes(32).toString('base64url');
    const expiredSignature = createHmac('sha256', process.env.SHARE_TOKEN_SECRET!).update(`comment:v1:${expiredAt}:${nonce}`).digest('base64url');
    const expiredCookie = `__Host-theke-comment=v1.${expiredAt}.${nonce}.${expiredSignature}`;
    expect((await comments.list(firstToken, expiredCookie)).identity).toBeNull();
    const repeatedName = await comments.create(firstToken, { displayName: 'Ana Sol', content: 'Nueva identidad' }, expiredCookie, undefined, '127.0.0.3');
    expect(repeatedName.session).toBeTruthy();
    expect((await comments.list(firstToken, cookie)).comments.find(item => item.id === repeatedName.comment.id)?.editable).toBe(false);
    await database.db.update(diagramShares).set({ commentsEnabled: false }).where(eq(diagramShares.id, shareIds[0]!));
    await expect(comments.create(firstToken, { content: 'Bloqueado' }, cookie, recognized.csrfToken!, '127.0.0.1')).rejects.toMatchObject({ status: 409 });
    expect((await comments.list(firstToken)).comments).toHaveLength(3);
    await database.db.update(diagramShares).set({ revokedAt: new Date() }).where(eq(diagramShares.id, shareIds[0]!));
    await expect(comments.list(firstToken)).rejects.toMatchObject({ status: 404 });
  }, 30_000);
});
