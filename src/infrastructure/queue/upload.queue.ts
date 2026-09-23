import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { fromDrizzle, PgBoss, type DrizzleTransactionLike } from 'pg-boss';

export const UPLOAD_QUEUE = 'upload-inspect';
export const UPLOAD_DEAD_QUEUE = 'upload-inspect.dead';

@Injectable()
export class UploadQueue implements OnModuleInit, OnModuleDestroy {
  readonly boss = new PgBoss(process.env.DATABASE_URL!);
  constructor() { this.boss.on('error', error => console.error('pg-boss:', error.message)); }
  async onModuleInit() { await this.boss.start(); await this.boss.createQueue(UPLOAD_DEAD_QUEUE, { retentionSeconds: 2_592_000 }); await this.boss.createQueue(UPLOAD_QUEUE, { retryLimit: 3, retryBackoff: true, retryDelay: 5, deadLetter: UPLOAD_DEAD_QUEUE, expireInSeconds: 900 }); }
  async enqueue(uploadId: string, requestId: string, tx: DrizzleTransactionLike) { await this.boss.send(UPLOAD_QUEUE, { uploadId, requestId }, { singletonKey: uploadId, db: fromDrizzle(tx, sql) }); }
  async onModuleDestroy() { await this.boss.stop({ graceful: true }); }
}
