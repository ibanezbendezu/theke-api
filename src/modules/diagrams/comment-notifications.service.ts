import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { Database } from '../../infrastructure/database/database.js';
import { commentNotifications, diagrams, projects, publicShareComments, users } from '../../infrastructure/database/schema.js';

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
    const anchored = sql<boolean>`jsonb_typeof(${publicShareComments.anchor} -> 'x') = 'number' and jsonb_typeof(${publicShareComments.anchor} -> 'y') = 'number'`;
    const conditions = [eq(commentNotifications.accountId, accountId), isNull(publicShareComments.deletedAt)];
    if (input.diagramId) conditions.push(eq(commentNotifications.diagramId, input.diagramId));
    if (input.commentId) conditions.push(eq(commentNotifications.commentId, input.commentId));
    if (filter === 'pending') conditions.push(isNull(commentNotifications.readAt), isNull(publicShareComments.resolvedAt));
    if (filter === 'resolved') conditions.push(isNotNull(publicShareComments.resolvedAt));
    if (filter === 'anchored') conditions.push(anchored);
    if (filter === 'unanchored') conditions.push(sql`not (${anchored})`);
    const rows = await this.database.db.select({
      id: commentNotifications.id, commentId: publicShareComments.id, diagramId: commentNotifications.diagramId,
      projectId: projects.id, diagramName: diagrams.name, displayName: publicShareComments.displayName,
      profileName: users.displayName, content: publicShareComments.content, anchor: publicShareComments.anchor,
      createdAt: publicShareComments.createdAt, readAt: commentNotifications.readAt,
      resolvedAt: publicShareComments.resolvedAt,
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
      anchored: typeof row.anchor.x === 'number' && typeof row.anchor.y === 'number',
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
    return { latestId: latest?.id ?? null, unreadCount: await this.unreadCount(accountId) };
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
}
