import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { validateEnvironment } from './config/environment.js';
import { UPLOAD_QUEUE, UploadQueue } from './infrastructure/queue/upload.queue.js';
import { UploadProcessor } from './modules/uploads/upload.processor.js';
import type { JobWithMetadata } from 'pg-boss';

validateEnvironment();
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
const queue = app.get(UploadQueue); const processor = app.get(UploadProcessor);
await queue.boss.work(UPLOAD_QUEUE, { includeMetadata: true }, async ([job]: JobWithMetadata<{ uploadId: string; requestId: string }>[]) => {
  if (!job) return;
  try { await processor.process(job.data.uploadId); }
  catch (error) { if (job.retryCount >= job.retryLimit) await processor.exhausted(job.data.uploadId); throw error; }
});
const shutdown = async () => { await app.close(); process.exit(0); };
process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
