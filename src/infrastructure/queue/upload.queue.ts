import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { fromDrizzle, PgBoss, type DrizzleTransactionLike } from 'pg-boss';

export const UPLOAD_QUEUE = 'upload-inspect';
export const UPLOAD_DEAD_QUEUE = 'upload-inspect.dead';
export const LINK_QUEUE = 'link-metadata';
export const LINK_DEAD_QUEUE = 'link-metadata.dead';

@Injectable()
export class UploadQueue implements OnModuleInit, OnModuleDestroy {
  readonly boss = new PgBoss(process.env.DATABASE_URL!);
  constructor() { this.boss.on('error', error => console.error('pg-boss:', error.message)); }
  async onModuleInit() { await this.boss.start(); await this.boss.createQueue(UPLOAD_DEAD_QUEUE, { retentionSeconds: 2_592_000 }); await this.boss.createQueue(UPLOAD_QUEUE, { retryLimit: 3, retryBackoff: true, retryDelay: 5, deadLetter: UPLOAD_DEAD_QUEUE, expireInSeconds: 900 }); await this.boss.createQueue(LINK_DEAD_QUEUE, { retentionSeconds: 2_592_000 }); await this.boss.createQueue(LINK_QUEUE, { retryLimit: 2, retryBackoff: true, retryDelay: 5, deadLetter: LINK_DEAD_QUEUE, expireInSeconds: 60 }); }
  async enqueue(uploadId: string, requestId: string, tx: DrizzleTransactionLike) { await this.boss.send(UPLOAD_QUEUE, { uploadId, requestId }, { singletonKey: uploadId, db: fromDrizzle(tx, sql) }); }
  async enqueueLink(resourceId: string, requestedAt: string, tx: DrizzleTransactionLike) { await this.boss.send(LINK_QUEUE, { resourceId, requestedAt }, { singletonKey: `${resourceId}:${requestedAt}`, db: fromDrizzle(tx, sql) }); }
  async onModuleDestroy() { await this.boss.stop({ graceful: true }); }
}
