import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { IncomingMessage } from 'node:http';
import cors from '@fastify/cors';
import { AppModule } from './app.module.js';
import { HttpErrorFilter } from './interfaces/http/http-exception.filter.js';
import { parseEnvironmentList, validateEnvironment } from './config/environment.js';

validateEnvironment();
const adapter = new FastifyAdapter({ logger: { redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'] }, genReqId: (request: IncomingMessage) => String(request.headers['x-request-id'] ?? crypto.randomUUID()) });
const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, { rawBody: true });
await app.register(cors, { origin: parseEnvironmentList('WEB_ORIGINS'), methods: ['GET', 'POST', 'PATCH', 'OPTIONS'], allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'] });
app.getHttpAdapter().getInstance().addHook('onRequest', (request, reply, done) => {
  reply.header('x-request-id', request.id);
  done();
});
app.useGlobalFilters(new HttpErrorFilter());
await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
