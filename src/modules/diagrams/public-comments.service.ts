import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, count, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { Database } from '../../infrastructure/database/database.js';
import { diagramShares, publicShareComments, publicShareCommentMutations, users, type PublicCommentAnchor } from '../../infrastructure/database/schema.js';
import { withSerializationRetry } from '../../infrastructure/database/serialization-retry.js';
import { publicCommentRatePolicy } from './public-comment-rate-policy.js';
import { scientificAlias } from './public-comment-alias.js';

type CommentUser = { id: string; displayName: string };

const shareTokenPattern = /^[A-Za-z0-9_-]{43}$/;
const cookieName = '__Host-theke-comment';
const ageSeconds = 30 * 24 * 60 * 60;

@Injectable()
export class PublicCommentsService {
  constructor(@Inject(Database) private readonly database: Database) {}

  private secret() {
    const secret = process.env.SHARE_TOKEN_SECRET;
    if (!secret || Buffer.byteLength(secret) < 32) throw new Error('SHARE_TOKEN_SECRET must contain at least 32 bytes');
    return secret;
  }

  private digest(value: string) { return createHmac('sha256', this.secret()).update(value).digest('hex'); }
  private shareHash(token: string) {
    if (!shareTokenPattern.test(token)) throw new NotFoundException('Compartido no encontrado.');
    return createHash('sha256').update(token).digest('hex');
  }
  private async share(token: string) {
    const [row] = await this.database.db.select({ id: diagramShares.id, commentsEnabled: diagramShares.commentsEnabled })
      .from(diagramShares).where(and(eq(diagramShares.tokenHash, this.shareHash(token)), isNull(diagramShares.revokedAt))).limit(1);
    if (!row) throw new NotFoundException('Compartido no encontrado.');
    return row;
  }

  private session(cookieHeader?: string) {
    const value = cookieHeader?.split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    if (!value) return null;
    const match = /^v1\.([0-9]{10})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/.exec(value);
    if (!match) return null;
    const issued = Number(match[1]);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(issued) || issued > now + 60 || now - issued >= ageSeconds) return null;
    const expected = createHmac('sha256', this.secret()).update(`comment:v1:${match[1]}:${match[2]}`).digest();
    const supplied = Buffer.from(match[3]!, 'base64url');
    return supplied.length === expected.length && timingSafeEqual(supplied, expected) ? value : null;
  }

  private newSession() {
    const issued = Math.floor(Date.now() / 1000);
    const nonce = randomBytes(32).toString('base64url');
    const signature = createHmac('sha256', this.secret()).update(`comment:v1:${issued}:${nonce}`).digest('base64url');
    return `v1.${issued}.${nonce}.${signature}`;
  }

  private owner(shareId: string, session: string) { return this.digest(`owner:${shareId}:${session}`); }
  private registeredOwner(shareId: string, userId: string) { return this.digest(`registered-owner:${shareId}:${userId}`); }
  private csrf(shareId: string, session: string) { return this.digest(`csrf:${shareId}:${session}`); }
  cookieHeader(session: string) { return `${cookieName}=${session}; Max-Age=${ageSeconds}; Path=/; Secure; HttpOnly; SameSite=Lax`; }
  private validContent(input: unknown) {
    const content = typeof input === 'string' ? input.trim() : '';
    if (!content || content.length > 5000 || [...content].some(char => { const code = char.charCodeAt(0); return code < 32 && code !== 9 && code !== 10 && code !== 13 || code === 127; }))
      throw new BadRequestException({ message: 'Escribe un comentario de hasta 5.000 caracteres.', field: 'content' });
    return content;
  }

  private resolveAnchor(input: unknown, projection: typeof diagramShares.$inferSelect.projection): PublicCommentAnchor {
    if (input === undefined) return { type: 'diagram' }; // Existing clients can still publish a general comment.
    if (!input || typeof input !== 'object') throw new BadRequestException('Selecciona un punto, Recurso o Relación para comentar.');
    const value = input as Record<string, unknown>;
    const hasPoint = value.x !== undefined || value.y !== undefined;
    if (hasPoint && (typeof value.x !== 'number' || typeof value.y !== 'number' || !Number.isFinite(value.x) || !Number.isFinite(value.y) || Math.abs(value.x) > 1_000_000 || Math.abs(value.y) > 1_000_000))
      throw new BadRequestException('La posición del comentario no es válida.');
    const point = hasPoint ? { x: value.x as number, y: value.y as number } : {};
    if (value.type === 'diagram') {
      if (!hasPoint) throw new BadRequestException('Selecciona un punto del mapa.');
      return { type: 'diagram', ...point };
    }
    const nodes = projection.layout?.nodes ?? [];
    const positionOf = (resourceId: string) => {
      const node = nodes.find(item => item.resourceId === resourceId);
      return node && typeof node.x === 'number' && typeof node.y === 'number'
        ? { x: node.x + (typeof node.width === 'number' ? node.width / 2 : 144), y: node.y + (typeof node.height === 'number' ? node.height / 2 : 56) } : null;
    };
    if (value.type === 'resource' && typeof value.resourceId === 'string') {
      const resource = projection.resources.find(item => typeof item === 'object' && item !== null && 'id' in item && item.id === value.resourceId) as { id: string; title?: string } | undefined;
      if (!resource) throw new NotFoundException('Destino no disponible en este Compartido.');
      return { type: 'resource', resourceId: resource.id, label: resource.title?.slice(0, 160) || 'Recurso', ...(positionOf(resource.id) ?? point) };
    }
    if (value.type === 'relation' && typeof value.relationId === 'string') {
      const relation = projection.relations.find(item => typeof item === 'object' && item !== null && 'id' in item && item.id === value.relationId) as { id: string; label?: string | null; typeKey?: string; sourceResourceId?: string; targetResourceId?: string } | undefined;
      if (!relation) throw new NotFoundException('Destino no disponible en este Compartido.');
      const source = relation.sourceResourceId ? positionOf(relation.sourceResourceId) : null;
      const target = relation.targetResourceId ? positionOf(relation.targetResourceId) : null;
      const middle = source && target ? { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 } : null;
      return { type: 'relation', relationId: relation.id, label: (relation.label || relation.typeKey || 'Relación').slice(0, 160), ...(middle ?? point) };
    }
    throw new BadRequestException('Selecciona un punto, Recurso o Relación para comentar.');
  }

  async list(token: string, cookieHeader?: string, user?: CommentUser) {
    const share = await this.share(token);
    const session = this.session(cookieHeader);
    const ownerHash = session ? this.owner(share.id, session) : null;
    const rows = await this.database.db.select({ id: publicShareComments.id, ownerHash: publicShareComments.ownerHash,
      authorUserId: publicShareComments.authorUserId, displayName: publicShareComments.displayName, currentProfileName: users.displayName,
      content: publicShareComments.content, anchor: publicShareComments.anchor,
      revision: publicShareComments.revision, editedAt: publicShareComments.editedAt, createdAt: publicShareComments.createdAt })
      .from(publicShareComments).leftJoin(users, eq(publicShareComments.authorUserId, users.id))
      .where(and(eq(publicShareComments.shareId, share.id), isNull(publicShareComments.deletedAt))).orderBy(desc(publicShareComments.createdAt)).limit(100);
    const [own] = ownerHash ? await this.database.db.select({ displayName: publicShareComments.displayName }).from(publicShareComments)
      .where(and(eq(publicShareComments.shareId, share.id), eq(publicShareComments.ownerHash, ownerHash))).limit(1) : [];
    return { identity: user ? { displayName: user.displayName } : own ? { displayName: own.displayName } : null,
      csrfToken: session ? this.csrf(share.id, session) : null,
      comments: rows.map(row => ({ id: row.id, displayName: row.authorUserId && row.currentProfileName ? row.currentProfileName : row.displayName, content: row.content, anchor: row.anchor,
        revision: row.revision, editedAt: row.editedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(),
        editable: user ? row.authorUserId === user.id : row.authorUserId === null && ownerHash !== null && ownerHash === row.ownerHash })) };
  }

  async create(token: string, input: { displayName?: unknown; content?: unknown; anchor?: unknown }, cookieHeader: string | undefined, csrfToken: string | undefined, ip: string, user?: CommentUser) {
    const content = this.validContent(input?.content);
    const existingSession = this.session(cookieHeader);
    const shareHash = this.shareHash(token);
    return withSerializationRetry(() => this.database.db.transaction(async tx => {
      const [share] = await tx.select({ id: diagramShares.id, commentsEnabled: diagramShares.commentsEnabled, projection: diagramShares.projection })
        .from(diagramShares).where(and(eq(diagramShares.tokenHash, shareHash), isNull(diagramShares.revokedAt))).for('update').limit(1);
      if (!share) throw new NotFoundException('Compartido no encontrado.');
      if (!share.commentsEnabled) throw new ConflictException('Este Compartido no acepta comentarios nuevos.');
      if (existingSession && csrfToken !== this.csrf(share.id, existingSession)) throw new ForbiddenException('Verificación de comentario no válida.');
      const anchor = this.resolveAnchor(input.anchor, share.projection);
      const session = existingSession ?? this.newSession();
      const ownerHash = user ? this.registeredOwner(share.id, user.id) : this.owner(share.id, session);
      const [previous] = await tx.select({ displayName: publicShareComments.displayName }).from(publicShareComments)
        .where(and(eq(publicShareComments.shareId, share.id), eq(publicShareComments.ownerHash, ownerHash))).limit(1);
      const displayName = user?.displayName ?? previous?.displayName ?? scientificAlias(this.secret(), session, share.id);
      const ipHash = this.digest(`ip:${ip}`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ipHash}, 0))`);
      const minute = new Date(Date.now() - 60_000); const hour = new Date(Date.now() - 3_600_000);
      const sessionMinute = await tx.select({ total: count() }).from(publicShareCommentMutations).where(and(eq(publicShareCommentMutations.ownerHash, ownerHash), gte(publicShareCommentMutations.createdAt, minute)));
      const sessionHour = await tx.select({ total: count() }).from(publicShareCommentMutations).where(and(eq(publicShareCommentMutations.ownerHash, ownerHash), gte(publicShareCommentMutations.createdAt, hour)));
      const ipMinute = await tx.select({ total: count() }).from(publicShareCommentMutations).where(and(eq(publicShareCommentMutations.ipHash, ipHash), gte(publicShareCommentMutations.createdAt, minute)));
      const ipHour = await tx.select({ total: count() }).from(publicShareCommentMutations).where(and(eq(publicShareCommentMutations.ipHash, ipHash), gte(publicShareCommentMutations.createdAt, hour)));
      const shareHour = await tx.select({ total: count() }).from(publicShareCommentMutations).where(and(eq(publicShareCommentMutations.shareId, share.id), gte(publicShareCommentMutations.createdAt, hour)));
      if ((sessionMinute[0]?.total ?? 0) >= publicCommentRatePolicy.sessionMinute || (sessionHour[0]?.total ?? 0) >= publicCommentRatePolicy.sessionHour || (ipMinute[0]?.total ?? 0) >= publicCommentRatePolicy.ipMinute || (ipHour[0]?.total ?? 0) >= publicCommentRatePolicy.ipHour || (shareHour[0]?.total ?? 0) >= publicCommentRatePolicy.shareHour)
        throw new HttpException('Límite de comentarios alcanzado. Inténtalo más tarde.', 429);
      const [comment] = await tx.insert(publicShareComments).values({ shareId: share.id, ownerHash, authorUserId: user?.id, ipHash, displayName, content, anchor }).returning({ id: publicShareComments.id, createdAt: publicShareComments.createdAt });
      await tx.insert(publicShareCommentMutations).values({ shareId: share.id, commentId: comment!.id, ownerHash, ipHash, action: 'created' });
      return { comment: { id: comment!.id, displayName, content, anchor, revision: 1, editedAt: null, createdAt: comment!.createdAt.toISOString(), editable: true },
        session: existingSession ? null : session };
    }, { isolationLevel: 'serializable' }));
  }

  async claim(token: string, cookieHeader: string | undefined, csrfToken: string | undefined, user: CommentUser) {
    const session = this.session(cookieHeader);
    if (!session) return { claimed: 0 };
    return this.database.db.transaction(async tx => {
      const [share] = await tx.select({ id: diagramShares.id }).from(diagramShares)
        .where(and(eq(diagramShares.tokenHash, this.shareHash(token)), isNull(diagramShares.revokedAt))).for('update').limit(1);
      if (!share) throw new NotFoundException('Compartido no encontrado.');
      if (csrfToken !== this.csrf(share.id, session)) throw new ForbiddenException('Verificación de comentario no válida.');
      const claimed = await tx.update(publicShareComments).set({ authorUserId: user.id, ownerHash: this.registeredOwner(share.id, user.id), displayName: user.displayName, updatedAt: new Date() })
        .where(and(eq(publicShareComments.shareId, share.id), eq(publicShareComments.ownerHash, this.owner(share.id, session)), isNull(publicShareComments.authorUserId)))
        .returning({ id: publicShareComments.id });
      return { claimed: claimed.length };
    });
  }

  async edit(token: string, commentId: string, input: { content?: unknown; expectedRevision?: unknown }, cookieHeader: string | undefined, csrfToken: string | undefined, ip: string, user?: CommentUser) {
    const content = this.validContent(input?.content);
    if (!Number.isSafeInteger(input?.expectedRevision) || (input.expectedRevision as number) < 1) throw new BadRequestException('La revisión del comentario no es válida.');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(commentId)) throw new NotFoundException('Comentario no disponible.');
    const session = this.session(cookieHeader);
    if (!session && !user) throw new ForbiddenException('Tu identidad de comentario ya no está disponible. Conserva el texto antes de continuar.');
    const shareHash = this.shareHash(token);
    return withSerializationRetry(() => this.database.db.transaction(async tx => {
      const [share] = await tx.select({ id: diagramShares.id, commentsEnabled: diagramShares.commentsEnabled })
        .from(diagramShares).where(and(eq(diagramShares.tokenHash, shareHash), isNull(diagramShares.revokedAt))).for('update').limit(1);
      if (!share) throw new NotFoundException('Compartido no encontrado.');
      if (!share.commentsEnabled) throw new ConflictException('Este Compartido no acepta cambios en comentarios.');
      if (session && csrfToken !== this.csrf(share.id, session)) throw new ForbiddenException('Verificación de comentario no válida.');
      const ownerHash = user ? this.registeredOwner(share.id, user.id) : this.owner(share.id, session!);
      const [current] = await tx.select().from(publicShareComments)
        .where(and(eq(publicShareComments.id, commentId), eq(publicShareComments.shareId, share.id), isNull(publicShareComments.deletedAt))).for('update').limit(1);
      if (!current || (user ? current.authorUserId !== user.id : current.authorUserId !== null || current.ownerHash !== ownerHash)) throw new NotFoundException('Comentario no disponible.');
      if (current.revision !== input.expectedRevision) throw new ConflictException({ message: 'El comentario cambió desde que abriste la edición.',
        details: { current: { id: current.id, content: current.content, revision: current.revision, editedAt: current.editedAt?.toISOString() ?? null } } });
      const ipHash = this.digest(`ip:${ip}`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ipHash}, 0))`);
      const minute = new Date(Date.now() - 60_000); const hour = new Date(Date.now() - 3_600_000);
      const sessionMinute = await tx.select({ total: count() }).from(publicShareCommentMutations).where(and(eq(publicShareCommentMutations.ownerHash, ownerHash), gte(publicShareCommentMutations.createdAt, minute)));
      const sessionHour = await tx.select({ total: count() }).from(publicShareCommentMutations).where(and(eq(publicShareCommentMutations.ownerHash, ownerHash), gte(publicShareCommentMutations.createdAt, hour)));
      const ipMinute = await tx.select({ total: count() }).from(publicShareCommentMutations).where(and(eq(publicShareCommentMutations.ipHash, ipHash), gte(publicShareCommentMutations.createdAt, minute)));
      const ipHour = await tx.select({ total: count() }).from(publicShareCommentMutations).where(and(eq(publicShareCommentMutations.ipHash, ipHash), gte(publicShareCommentMutations.createdAt, hour)));
      const shareHour = await tx.select({ total: count() }).from(publicShareCommentMutations).where(and(eq(publicShareCommentMutations.shareId, share.id), gte(publicShareCommentMutations.createdAt, hour)));
      if ((sessionMinute[0]?.total ?? 0) >= publicCommentRatePolicy.sessionMinute || (sessionHour[0]?.total ?? 0) >= publicCommentRatePolicy.sessionHour || (ipMinute[0]?.total ?? 0) >= publicCommentRatePolicy.ipMinute || (ipHour[0]?.total ?? 0) >= publicCommentRatePolicy.ipHour || (shareHour[0]?.total ?? 0) >= publicCommentRatePolicy.shareHour)
        throw new HttpException('Límite de comentarios alcanzado. Inténtalo más tarde.', 429);
      const editedAt = new Date();
      const [saved] = await tx.update(publicShareComments).set({ content, revision: current.revision + 1, updatedAt: editedAt, editedAt })
        .where(eq(publicShareComments.id, current.id)).returning({ revision: publicShareComments.revision });
      await tx.insert(publicShareCommentMutations).values({ shareId: share.id, commentId: current.id, ownerHash, ipHash, action: 'edited' });
      return { id: current.id, displayName: user?.displayName ?? current.displayName, content, anchor: current.anchor, createdAt: current.createdAt.toISOString(),
        editedAt: editedAt.toISOString(), revision: saved!.revision, editable: true };
    }, { isolationLevel: 'serializable' }));
  }
}
