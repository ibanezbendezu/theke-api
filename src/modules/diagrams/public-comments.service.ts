import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, count, desc, eq, gte, isNull } from 'drizzle-orm';
import { Database } from '../../infrastructure/database/database.js';
import { diagramShares, publicShareComments } from '../../infrastructure/database/schema.js';
import { withSerializationRetry } from '../../infrastructure/database/serialization-retry.js';

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
  private csrf(shareId: string, session: string) { return this.digest(`csrf:${shareId}:${session}`); }
  cookieHeader(session: string) { return `${cookieName}=${session}; Max-Age=${ageSeconds}; Path=/; Secure; HttpOnly; SameSite=Lax`; }

  async list(token: string, cookieHeader?: string) {
    const share = await this.share(token);
    const session = this.session(cookieHeader);
    const ownerHash = session ? this.owner(share.id, session) : null;
    const rows = await this.database.db.select({ id: publicShareComments.id, ownerHash: publicShareComments.ownerHash,
      displayName: publicShareComments.displayName, content: publicShareComments.content, anchor: publicShareComments.anchor, createdAt: publicShareComments.createdAt })
      .from(publicShareComments).where(eq(publicShareComments.shareId, share.id)).orderBy(desc(publicShareComments.createdAt)).limit(100);
    const [own] = ownerHash ? await this.database.db.select({ displayName: publicShareComments.displayName }).from(publicShareComments)
      .where(and(eq(publicShareComments.shareId, share.id), eq(publicShareComments.ownerHash, ownerHash))).limit(1) : [];
    return { identity: own ? { displayName: own.displayName } : null, csrfToken: session ? this.csrf(share.id, session) : null,
      comments: rows.map(row => ({ id: row.id, displayName: row.displayName, content: row.content, anchor: row.anchor,
        createdAt: row.createdAt.toISOString(), editable: ownerHash === row.ownerHash })) };
  }

  async create(token: string, input: { displayName?: unknown; content?: unknown }, cookieHeader: string | undefined, csrfToken: string | undefined, ip: string) {
    const content = typeof input?.content === 'string' ? input.content.trim() : '';
    if (!content || content.length > 5000 || [...content].some(char => { const code = char.charCodeAt(0); return code < 32 && code !== 9 && code !== 10 && code !== 13 || code === 127; })) throw new BadRequestException({ message: 'Escribe un comentario de hasta 5.000 caracteres.', field: 'content' });
    const providedName = typeof input.displayName === 'string' ? input.displayName.normalize('NFC').trim().replace(/\s+/g, ' ') : '';
    const existingSession = this.session(cookieHeader);
    const shareHash = this.shareHash(token);
    return withSerializationRetry(() => this.database.db.transaction(async tx => {
      const [share] = await tx.select({ id: diagramShares.id, commentsEnabled: diagramShares.commentsEnabled })
        .from(diagramShares).where(and(eq(diagramShares.tokenHash, shareHash), isNull(diagramShares.revokedAt))).for('update').limit(1);
      if (!share) throw new NotFoundException('Compartido no encontrado.');
      if (!share.commentsEnabled) throw new ConflictException('Este Compartido no acepta comentarios nuevos.');
      if (existingSession && csrfToken !== this.csrf(share.id, existingSession)) throw new ForbiddenException('Verificación de comentario no válida.');
      const session = existingSession ?? this.newSession();
      const ownerHash = this.owner(share.id, session);
      const [previous] = await tx.select({ displayName: publicShareComments.displayName }).from(publicShareComments)
        .where(and(eq(publicShareComments.shareId, share.id), eq(publicShareComments.ownerHash, ownerHash))).limit(1);
      const displayName = previous?.displayName ?? providedName;
      if (!displayName || displayName.length > 60 || /\p{C}/u.test(displayName)) throw new BadRequestException({ message: 'Escribe un nombre visible de hasta 60 caracteres.', field: 'displayName' });
      const ipHash = this.digest(`ip:${ip}`);
      const minute = new Date(Date.now() - 60_000); const hour = new Date(Date.now() - 3_600_000);
      const sessionMinute = await tx.select({ total: count() }).from(publicShareComments).where(and(eq(publicShareComments.ownerHash, ownerHash), gte(publicShareComments.createdAt, minute)));
      const sessionHour = await tx.select({ total: count() }).from(publicShareComments).where(and(eq(publicShareComments.ownerHash, ownerHash), gte(publicShareComments.createdAt, hour)));
      const ipMinute = await tx.select({ total: count() }).from(publicShareComments).where(and(eq(publicShareComments.ipHash, ipHash), gte(publicShareComments.createdAt, minute)));
      const ipHour = await tx.select({ total: count() }).from(publicShareComments).where(and(eq(publicShareComments.ipHash, ipHash), gte(publicShareComments.createdAt, hour)));
      const shareHour = await tx.select({ total: count() }).from(publicShareComments).where(and(eq(publicShareComments.shareId, share.id), gte(publicShareComments.createdAt, hour)));
      if ((sessionMinute[0]?.total ?? 0) >= 5 || (sessionHour[0]?.total ?? 0) >= 30 || (ipMinute[0]?.total ?? 0) >= 20 || (ipHour[0]?.total ?? 0) >= 100 || (shareHour[0]?.total ?? 0) >= 100)
        throw new HttpException('Límite de comentarios alcanzado. Inténtalo más tarde.', 429);
      const [comment] = await tx.insert(publicShareComments).values({ shareId: share.id, ownerHash, ipHash, displayName, content }).returning({ id: publicShareComments.id, createdAt: publicShareComments.createdAt });
      return { comment: { id: comment!.id, displayName, content, anchor: { type: 'diagram' as const }, createdAt: comment!.createdAt.toISOString(), editable: true },
        session: existingSession ? null : session };
    }, { isolationLevel: 'serializable' }));
  }
}
