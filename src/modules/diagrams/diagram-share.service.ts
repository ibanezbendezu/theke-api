import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { Database } from '../../infrastructure/database/database.js';
import { withSerializationRetry } from '../../infrastructure/database/serialization-retry.js';
import { diagramShareEvents, diagramShares, diagrams, projects, publicShareComments, relationTypes, resources as resourcesTable, resourceVersions } from '../../infrastructure/database/schema.js';
import { commonRelationTypes } from '../relations/relation.service.js';
import { UPLOAD_STORAGE, type UploadStorage } from '../uploads/upload.ports.js';
import { SharePreviewService } from './share-preview.service.js';
import { commentHasAnchor } from './comment-anchor.js';

const fingerprintPattern = /^[a-f0-9]{64}$/;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class DiagramShareService {
  constructor(@Inject(Database) private readonly database: Database, @Inject(SharePreviewService) private readonly preview: SharePreviewService, @Inject(UPLOAD_STORAGE) private readonly storage: UploadStorage) {}

  private tokenFor(accountId: string, diagramId: string, idempotencyKey: string) {
    const secret = process.env.SHARE_TOKEN_SECRET;
    if (!secret || Buffer.byteLength(secret) < 32) throw new Error('SHARE_TOKEN_SECRET must contain at least 32 bytes');
    return createHmac('sha256', secret).update(JSON.stringify([accountId, diagramId, idempotencyKey])).digest('base64url');
  }

  private async mediaFor(accountId: string, resources: { id: string; type: string }[], tx: Database['db']) {
    const fileIds = resources.filter(resource => resource.type === 'file').map(resource => resource.id);
    const files = fileIds.length ? await tx.select({ id: resourcesTable.id, versionId: resourceVersions.id, storageKey: resourceVersions.storageKey, mediaType: resourceVersions.mediaType, filename: resourcesTable.title })
      .from(resourcesTable).innerJoin(resourceVersions, and(eq(resourceVersions.id, resourcesTable.currentVersionId), eq(resourceVersions.resourceId, resourcesTable.id)))
      .where(and(eq(resourcesTable.accountId, accountId), isNull(resourcesTable.deletedAt), isNull(resourcesTable.archivedAt), inArray(resourcesTable.id, fileIds))) : [];
    if (files.length !== fileIds.length || files.some(file => !file.storageKey || !file.mediaType)) throw new ConflictException('Un archivo ya no está disponible para compartir.');
    return Object.fromEntries(files.map(file => [file.id, { versionId: file.versionId, storageKey: file.storageKey!, mediaType: file.mediaType!, filename: file.filename }]));
  }

  async publish(accountId: string, actorUserId: string, diagramId: string, input: { fingerprint?: unknown; idempotencyKey?: unknown }) {
    if (typeof input?.fingerprint !== 'string' || !fingerprintPattern.test(input.fingerprint)) throw new BadRequestException('Huella de revisión inválida.');
    if (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim() || input.idempotencyKey.length > 120) throw new BadRequestException('Clave de idempotencia inválida.');
    const token = this.tokenFor(accountId, diagramId, input.idempotencyKey);
    const tokenHash = createHash('sha256').update(token).digest('hex');
    return withSerializationRetry(() => this.database.db.transaction(async tx => {
      const [diagram] = await tx.select({ id: diagrams.id }).from(diagrams)
        .innerJoin(projects, and(eq(projects.id, diagrams.projectId), eq(projects.accountId, accountId), isNull(projects.deletedAt)))
        .where(and(eq(diagrams.id, diagramId), isNull(diagrams.deletedAt))).for('update').limit(1);
      if (!diagram) throw new NotFoundException('Diagrama no encontrado.');
      const [prior] = await tx.select({ id: diagramShares.id, diagramId: diagramShares.diagramId, fingerprint: diagramShares.fingerprint, tokenHash: diagramShares.tokenHash, revokedAt: diagramShares.revokedAt })
        .from(diagramShares).where(and(eq(diagramShares.accountId, accountId), eq(diagramShares.idempotencyKey, input.idempotencyKey as string))).limit(1);
      if (prior) {
        if (prior.diagramId !== diagramId || prior.fingerprint !== input.fingerprint || prior.tokenHash !== tokenHash || prior.revokedAt) throw new ConflictException('La clave de idempotencia ya se usó para otro Compartido.');
        await tx.insert(diagramShareEvents).values({ accountId, diagramId, shareId: prior.id, actorUserId, action: 'retried' });
        return { url: `/share/${token}`, token };
      }
      const [active] = await tx.select({ id: diagramShares.id }).from(diagramShares).where(and(eq(diagramShares.diagramId, diagramId), isNull(diagramShares.revokedAt))).limit(1);
      if (active) throw new ConflictException('El diagrama ya tiene un Compartido activo.');
      const current = await this.preview.get(accountId, diagramId, tx as unknown as Database['db']);
      if (!current.ready || current.fingerprint !== input.fingerprint) throw new ConflictException('La vista previa cambió o no está lista; revísala de nuevo.');
      const { diagramName, revision, resources, relations, layout } = current;
      const mediaManifest = await this.mediaFor(accountId, resources, tx as unknown as Database['db']);
      const shareId = crypto.randomUUID();
      await tx.insert(diagramShares).values({ id: shareId, accountId, diagramId, idempotencyKey: input.idempotencyKey as string,
        fingerprint: current.fingerprint, tokenHash, projection: { diagramName, revision, resources, relations, layout }, mediaManifest });
      await tx.insert(diagramShareEvents).values({ accountId, diagramId, shareId, actorUserId, action: 'published' });
      return { url: `/share/${token}`, token };
    }, { isolationLevel: 'serializable' }));
  }

  async manage(accountId: string, diagramId: string) {
    const [diagram] = await this.database.db.select({ id: diagrams.id }).from(diagrams)
      .innerJoin(projects, and(eq(projects.id, diagrams.projectId), eq(projects.accountId, accountId), isNull(projects.deletedAt)))
      .where(and(eq(diagrams.id, diagramId), isNull(diagrams.deletedAt))).limit(1);
    if (!diagram) throw new NotFoundException('Diagrama no encontrado.');
    const [share] = await this.database.db.select({ id: diagramShares.id, idempotencyKey: diagramShares.idempotencyKey, fingerprint: diagramShares.fingerprint,
      projection: diagramShares.projection, commentsEnabled: diagramShares.commentsEnabled }).from(diagramShares)
      .where(and(eq(diagramShares.accountId, accountId), eq(diagramShares.diagramId, diagramId), isNull(diagramShares.revokedAt))).limit(1);
    if (!share) return { active: false as const };
    const token = this.tokenFor(accountId, diagramId, share.idempotencyKey);
    return { active: true as const, url: `/share/${token}`, fingerprint: share.fingerprint,
      revision: share.projection.revision, commentsEnabled: share.commentsEnabled };
  }

  async setComments(accountId: string, actorUserId: string, diagramId: string, input: { enabled?: unknown }) {
    if (typeof input?.enabled !== 'boolean') throw new BadRequestException('Estado de comentarios inválido.');
    const enabled = input.enabled;
    return withSerializationRetry(() => this.database.db.transaction(async tx => {
      const [share] = await tx.select({ id: diagramShares.id, commentsEnabled: diagramShares.commentsEnabled }).from(diagramShares)
        .where(and(eq(diagramShares.accountId, accountId), eq(diagramShares.diagramId, diagramId), isNull(diagramShares.revokedAt))).for('update').limit(1);
      if (!share) throw new NotFoundException('Compartido activo no encontrado.');
      if (share.commentsEnabled !== enabled) {
        await tx.update(diagramShares).set({ commentsEnabled: enabled }).where(eq(diagramShares.id, share.id));
        await tx.insert(diagramShareEvents).values({ accountId, diagramId, shareId: share.id, actorUserId, action: 'comments_changed' });
      }
      return { commentsEnabled: enabled };
    }, { isolationLevel: 'serializable' }));
  }

  async refresh(accountId: string, actorUserId: string, diagramId: string, input: { fingerprint?: unknown; expectedPublishedFingerprint?: unknown }) {
    if (typeof input?.fingerprint !== 'string' || !fingerprintPattern.test(input.fingerprint) ||
      typeof input.expectedPublishedFingerprint !== 'string' || !fingerprintPattern.test(input.expectedPublishedFingerprint)) throw new BadRequestException('Huella de revisión inválida.');
    return withSerializationRetry(() => this.database.db.transaction(async tx => {
      const [diagram] = await tx.select({ id: diagrams.id }).from(diagrams)
        .innerJoin(projects, and(eq(projects.id, diagrams.projectId), eq(projects.accountId, accountId), isNull(projects.deletedAt)))
        .where(and(eq(diagrams.id, diagramId), isNull(diagrams.deletedAt))).for('update').limit(1);
      if (!diagram) throw new NotFoundException('Diagrama no encontrado.');
      const [share] = await tx.select({ id: diagramShares.id, fingerprint: diagramShares.fingerprint, revision: diagramShares.projection }).from(diagramShares)
        .where(and(eq(diagramShares.accountId, accountId), eq(diagramShares.diagramId, diagramId), isNull(diagramShares.revokedAt))).for('update').limit(1);
      if (!share) throw new NotFoundException('Compartido activo no encontrado.');
      if (share.fingerprint !== input.expectedPublishedFingerprint) throw new ConflictException('La versión pública cambió; revisa el Compartido de nuevo.');
      const current = await this.preview.get(accountId, diagramId, tx as unknown as Database['db']);
      if (!current.ready || current.fingerprint !== input.fingerprint) throw new ConflictException('La vista previa cambió o no está lista; revísala de nuevo.');
      if (share.fingerprint === current.fingerprint) return { fingerprint: share.fingerprint, revision: share.revision.revision };
      const { diagramName, revision, resources, relations, layout } = current;
      const mediaManifest = await this.mediaFor(accountId, resources, tx as unknown as Database['db']);
      const projection = { diagramName, revision, resources, relations, layout };
      const comments = await tx.select({ id: publicShareComments.id, anchor: publicShareComments.anchor })
        .from(publicShareComments).where(and(eq(publicShareComments.shareId, share.id), isNull(publicShareComments.deletedAt), isNull(publicShareComments.orphanedAt)));
      for (const comment of comments) if (!commentHasAnchor(comment.anchor, projection))
        await tx.update(publicShareComments).set({ orphanedAt: new Date() }).where(eq(publicShareComments.id, comment.id));
      await tx.update(diagramShares).set({ fingerprint: current.fingerprint, projection, mediaManifest })
        .where(eq(diagramShares.id, share.id));
      await tx.insert(diagramShareEvents).values({ accountId, diagramId, shareId: share.id, actorUserId, action: 'refreshed' });
      return { fingerprint: current.fingerprint, revision };
    }, { isolationLevel: 'serializable' }));
  }

  async revoke(accountId: string, actorUserId: string, diagramId: string, input: { expectedPublishedFingerprint?: unknown; confirmation?: unknown }) {
    if (input?.confirmation !== 'REVOCAR' || typeof input.expectedPublishedFingerprint !== 'string' || !fingerprintPattern.test(input.expectedPublishedFingerprint))
      throw new BadRequestException('Confirmación de revocación inválida.');
    return withSerializationRetry(() => this.database.db.transaction(async tx => {
      const [share] = await tx.select({ id: diagramShares.id, fingerprint: diagramShares.fingerprint }).from(diagramShares)
        .where(and(eq(diagramShares.accountId, accountId), eq(diagramShares.diagramId, diagramId), isNull(diagramShares.revokedAt))).for('update').limit(1);
      if (!share) throw new NotFoundException('Compartido activo no encontrado.');
      if (share.fingerprint !== input.expectedPublishedFingerprint) throw new ConflictException('La versión pública cambió; revisa el Compartido de nuevo.');
      await tx.update(diagramShares).set({ revokedAt: new Date() }).where(eq(diagramShares.id, share.id));
      await tx.insert(diagramShareEvents).values({ accountId, diagramId, shareId: share.id, actorUserId, action: 'revoked' });
      return { active: false as const };
    }, { isolationLevel: 'serializable' }));
  }

  private async shareForToken(token: string) {
    if (!tokenPattern.test(token)) throw new NotFoundException('Compartido no encontrado.');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const [share] = await this.database.db.select({ accountId: diagramShares.accountId, projection: diagramShares.projection, mediaManifest: diagramShares.mediaManifest, commentsEnabled: diagramShares.commentsEnabled }).from(diagramShares)
      .where(and(eq(diagramShares.tokenHash, tokenHash), isNull(diagramShares.revokedAt))).limit(1);
    if (!share) throw new NotFoundException('Compartido no encontrado.');
    return share;
  }

  async getPublic(token: string) {
    const share = await this.shareForToken(token);
    const { diagramName, revision, resources, relations, layout } = share.projection;
    const legacy = relations.filter(item => typeof item === 'object' && item !== null && 'typeKey' in item && !('typeLabel' in item)) as { typeKey: string }[];
    const customIds = [...new Set(legacy.filter(item => item.typeKey.startsWith('custom:')).map(item => item.typeKey.slice(7)))];
    const customTypes = customIds.length ? await this.database.db.select({ id: relationTypes.id, label: relationTypes.label }).from(relationTypes)
      .where(and(eq(relationTypes.accountId, share.accountId), inArray(relationTypes.id, customIds))) : [];
    const customLabels = new Map(customTypes.map(item => [item.id, item.label]));
    const publicRelations = relations.map(item => {
      if (typeof item !== 'object' || item === null || !('typeKey' in item) || 'typeLabel' in item) return item;
      const relation = item as { typeKey: string };
      const typeLabel = relation.typeKey.startsWith('custom:') ? customLabels.get(relation.typeKey.slice(7)) ?? 'Relación'
        : commonRelationTypes.find(type => type.key === relation.typeKey)?.label ?? 'Relación';
      return { ...relation, typeLabel };
    });
    return { diagramName, revision, resources, relations: publicRelations, layout: layout ?? { nodes: [], edges: [] }, commentsEnabled: share.commentsEnabled };
  }

  async getPublicMedia(token: string, resourceId: string) {
    if (!uuidPattern.test(resourceId)) throw new NotFoundException('Archivo compartido no encontrado.');
    const share = await this.shareForToken(token);
    const entry = share.mediaManifest[resourceId];
    const listed = share.projection.resources.some(resource => typeof resource === 'object' && resource !== null && 'id' in resource && resource.id === resourceId && 'type' in resource && resource.type === 'file');
    if (!entry || !listed) throw new NotFoundException('Archivo compartido no encontrado.');
    try { return { content: await this.storage.read(entry.storageKey), mediaType: entry.mediaType, filename: entry.filename }; }
    catch { throw new NotFoundException('Archivo compartido no disponible.'); }
  }
}
