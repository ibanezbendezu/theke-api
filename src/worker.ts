import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { validateEnvironment } from './config/environment.js';
import { LINK_QUEUE, SHARE_QUEUE, UPLOAD_QUEUE, UploadQueue, type ShareSyncJob } from './infrastructure/queue/upload.queue.js';
import { UploadProcessor } from './modules/uploads/upload.processor.js';
import { LinkProcessor } from './modules/resources/link.processor.js';
import { CommentNotificationsService } from './modules/diagrams/comment-notifications.service.js';
import { DiagramShareService } from './modules/diagrams/diagram-share.service.js';
import type { JobWithMetadata } from 'pg-boss';

validateEnvironment();
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
const queue = app.get(UploadQueue); const processor = app.get(UploadProcessor); const linkProcessor = app.get(LinkProcessor);
const commentNotifications = app.get(CommentNotificationsService);
const shares = app.get(DiagramShareService);
const purgeComments = () => { void commentNotifications.purgeExpired().catch(() => console.error('No se pudo purgar comentarios vencidos.')); };
purgeComments();
const commentPurgeTimer = setInterval(purgeComments, 60 * 60 * 1000);
await queue.boss.work(UPLOAD_QUEUE, { includeMetadata: true }, async ([job]: JobWithMetadata<{ uploadId: string; requestId: string }>[]) => {
  if (!job) return;
  try { await processor.process(job.data.uploadId); }
  catch (error) { if (job.retryCount >= job.retryLimit) await processor.exhausted(job.data.uploadId); throw error; }
});
await queue.boss.work(LINK_QUEUE, async ([job]: { data: { resourceId: string; requestedAt: string } }[]) => { if (job) await linkProcessor.process(job.data.resourceId, job.data.requestedAt); });
await queue.boss.work(SHARE_QUEUE, async ([job]: { data: ShareSyncJob }[]) => {
  if (!job) return;
  const { accountId, actorUserId } = job.data;
  if (job.data.diagramId) {
    if (await shares.syncAfterSave(accountId, actorUserId, job.data.diagramId) === 'failed') throw new Error('No se pudo actualizar el mapa compartido.');
  } else if (job.data.resourceId) {
    await shares.syncForResource(accountId, actorUserId, job.data.resourceId);
  }
});
const shutdown = async () => { clearInterval(commentPurgeTimer); await app.close(); process.exit(0); };
process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
