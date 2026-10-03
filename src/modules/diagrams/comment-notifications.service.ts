import { BadRequestException, HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { Database } from '../../infrastructure/database/database.js';
import { commentModerationEvents, commentNotifications, diagrams, projects, publicShareCommentMutations, publicShareComments, users } from '../../infrastructure/database/schema.js';

const moderationPolicy = { minute: 30, hour: 300 } as const;

@Injectable()
export class CommentNotificationsService {
  constructor(@Inject(Database) private readonly database: Database) {}

  async list(accountId: string, input: { diagramId?: string; commentId?: string; page?: string; filter?: string }) {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (input.diagramId && !uuid.test(input.diagramId) || input.commentId && !uuid.test(input.commentId))
      throw new BadRequestException('Identificador no válido.');
    const page = input.page === undefined ? 1 : Number(input.page);
    if (!Number.isInteger(page) || page < 1 || page > 10000) throw new BadRequestException('Página no válida.');
    const filter = input.filter ?? 'all';
    if (!['all', 'pending', 'resolved', 'anchored', 'unanchored'].includes(filter)) throw new BadRequestException('Filtro no válido.');
    const conditions = [eq(commentNotifications.accountId, accountId), isNull(publicShareComments.deletedAt)];
    if (input.diagramId) conditions.push(eq(commentNotifications.diagramId, input.diagramId));
    if (input.commentId) conditions.push(eq(commentNotifications.commentId, input.commentId));
    if (filter === 'pending') conditions.push(isNull(commentNotifications.readAt), isNull(publicShareComments.resolvedAt));
    if (filter === 'resolved') conditions.push(isNotNull(publicShareComments.resolvedAt));
    if (filter === 'anchored') conditions.push(isNull(publicShareComments.orphanedAt));
    if (filter === 'unanchored') conditions.push(isNotNull(publicShareComments.orphanedAt));
    const rows = await this.database.db.select({
      id: commentNotifications.id, commentId: publicShareComments.id, diagramId: commentNotifications.diagramId,
      projectId: projects.id, diagramName: diagrams.name, displayName: publicShareComments.displayName,
      profileName: users.displayName, content: publicShareComments.content, anchor: publicShareComments.anchor,
      createdAt: publicShareComments.createdAt, readAt: commentNotifications.readAt,
      resolvedAt: publicShareComments.resolvedAt, orphanedAt: publicShareComments.orphanedAt,
    }).from(commentNotifications)
      .innerJoin(publicShareComments, eq(commentNotifications.commentId, publicShareComments.id))
      .innerJoin(diagrams, eq(commentNotifications.diagramId, diagrams.id))
      .innerJoin(projects, eq(diagrams.projectId, projects.id))
      .leftJoin(users, eq(publicShareComments.authorUserId, users.id))
      .where(and(...conditions)).orderBy(desc(commentNotifications.createdAt), desc(commentNotifications.id))
      .limit(21).offset((page - 1) * 20);
    const unreadCount = await this.unreadCount(accountId);
    return { items: rows.slice(0, 20).map(row => ({
      id: row.id, commentId: row.commentId, diagramId: row.diagramId, projectId: row.projectId,
      diagramName: row.diagramName, displayName: row.profileName ?? row.displayName,
      content: row.content, anchor: row.anchor, createdAt: row.createdAt.toISOString(),
      readAt: row.readAt?.toISOString() ?? null, resolvedAt: row.resolvedAt?.toISOString() ?? null,
      anchored: row.orphanedAt === null && typeof row.anchor.x === 'number' && typeof row.anchor.y === 'number',
    })), page, hasMore: rows.length > 20, unreadCount };
  }

  async unreadCount(accountId: string) {
    const [row] = await this.database.db.select({ total: count() }).from(commentNotifications)
      .innerJoin(publicShareComments, eq(commentNotifications.commentId, publicShareComments.id))
      .where(and(eq(commentNotifications.accountId, accountId), isNull(commentNotifications.readAt),
        isNull(publicShareComments.resolvedAt), isNull(publicShareComments.deletedAt)));
    return row?.total ?? 0;
  }

  async signal(accountId: string) {
    const [latest] = await this.database.db.select({ id: commentNotifications.id })
      .from(commentNotifications).where(eq(commentNotifications.accountId, accountId))
      .orderBy(desc(commentNotifications.createdAt), desc(commentNotifications.id)).limit(1);
    const [moderation] = await this.database.db.select({ id: commentModerationEvents.id }).from(commentModerationEvents)
      .where(eq(commentModerationEvents.accountId, accountId))
      .orderBy(desc(commentModerationEvents.createdAt), desc(commentModerationEvents.id)).limit(1);
    return { latestId: latest?.id ?? null, moderationId: moderation?.id ?? null, unreadCount: await this.unreadCount(accountId) };
  }

  async markRead(accountId: string, notificationId: string) {
    const [row] = await this.database.db.update(commentNotifications).set({ readAt: new Date() })
      .where(and(eq(commentNotifications.id, notificationId), eq(commentNotifications.accountId, accountId), isNull(commentNotifications.readAt)))
      .returning({ id: commentNotifications.id, readAt: commentNotifications.readAt });
    const [existing] = row ? [row] : await this.database.db.select({ id: commentNotifications.id, readAt: commentNotifications.readAt })
      .from(commentNotifications).where(and(eq(commentNotifications.id, notificationId), eq(commentNotifications.accountId, accountId))).limit(1);
    if (!existing) throw new NotFoundException('Aviso no disponible.');
    return { id: existing.id, readAt: existing.readAt!.toISOString() };
  }

  async moderate(accountId: string, actorUserId: string, notificationId: string, action: 'resolve' | 'reopen' | 'delete') {
    return this.database.db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`comment-moderation:${accountId}:${actorUserId}`}, 0))`);
      const [notification] = await tx.select().from(commentNotifications)
        .where(and(eq(commentNotifications.id, notificationId), eq(commentNotifications.accountId, accountId))).for('update').limit(1);
      if (!notification) throw new NotFoundException('Comentario no disponible.');
      const [comment] = await tx.select().from(publicShareComments)
        .where(and(eq(publicShareComments.id, notification.commentId), isNull(publicShareComments.deletedAt))).for('update').limit(1);
      if (!comment) throw new NotFoundException('Comentario no disponible.');
      const already = action === 'resolve' ? comment.resolvedAt !== null : action === 'reopen' ? comment.resolvedAt === null : false;
      if (already) return { id: notificationId, resolvedAt: comment.resolvedAt?.toISOString() ?? null, deleted: false };
      const [minute] = await tx.select({ total: count() }).from(commentModerationEvents)
        .where(and(eq(commentModerationEvents.accountId, accountId), eq(commentModerationEvents.actorUserId, actorUserId),
          gte(commentModerationEvents.createdAt, new Date(Date.now() - 60_000))));
      const [hour] = await tx.select({ total: count() }).from(commentModerationEvents)
        .where(and(eq(commentModerationEvents.accountId, accountId), eq(commentModerationEvents.actorUserId, actorUserId),
          gte(commentModerationEvents.createdAt, new Date(Date.now() - 3_600_000))));
      if ((minute?.total ?? 0) >= moderationPolicy.minute || (hour?.total ?? 0) >= moderationPolicy.hour)
        throw new HttpException('Demasiadas acciones de moderación. Inténtalo más tarde.', 429);
      const now = new Date();
      const resolvedAt = action === 'resolve' ? now : null;
      await tx.update(publicShareComments).set(action === 'delete'
        ? { deletedAt: now, purgeAfter: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) }
        : { resolvedAt }).where(eq(publicShareComments.id, comment.id));
      await tx.update(commentNotifications).set({ readAt: action === 'reopen' ? null : now })
        .where(eq(commentNotifications.id, notificationId));
      await tx.insert(commentModerationEvents).values({ accountId, actorUserId, commentId: comment.id,
        action: action === 'resolve' ? 'resolved' : action === 'reopen' ? 'reopened' : 'deleted' });
      return { id: notificationId, resolvedAt: action === 'delete' ? comment.resolvedAt?.toISOString() ?? null : resolvedAt?.toISOString() ?? null,
        deleted: action === 'delete' };
    });
  }

  async purgeExpired() {
    return this.database.db.transaction(async tx => {
      const expired = await tx.select({ id: publicShareComments.id }).from(publicShareComments)
        .where(and(isNotNull(publicShareComments.purgeAfter), lt(publicShareComments.purgeAfter, new Date())))
        .limit(100).for('update', { skipLocked: true });
      const ids = expired.map(item => item.id);
      if (!ids.length) return 0;
      await tx.delete(commentNotifications).where(inArray(commentNotifications.commentId, ids));
      await tx.delete(publicShareCommentMutations).where(inArray(publicShareCommentMutations.commentId, ids));
      await tx.delete(publicShareComments).where(inArray(publicShareComments.id, ids));
      return ids.length;
    });
  }
}
