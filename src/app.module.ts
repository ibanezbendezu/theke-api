import { Module } from '@nestjs/common';
import { Database } from './infrastructure/database/database.js';
import { ClerkAuthGuard } from './infrastructure/auth/clerk-auth.guard.js';
import { AccountService } from './modules/account/account.service.js';
import { HealthController } from './interfaces/http/health.controller.js';
import { MeController } from './interfaces/http/me.controller.js';
import { ClerkWebhookController } from './interfaces/http/clerk-webhook.controller.js';
@Module({ controllers: [HealthController, MeController, ClerkWebhookController], providers: [Database, ClerkAuthGuard, AccountService] }) export class AppModule {}
