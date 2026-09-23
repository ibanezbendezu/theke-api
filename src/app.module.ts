import { Module } from '@nestjs/common';
import { Database } from './infrastructure/database/database.js';
import { ClerkAuthGuard } from './infrastructure/auth/clerk-auth.guard.js';
import { AccountService } from './modules/account/account.service.js';
import { HealthController } from './interfaces/http/health.controller.js';
import { MeController } from './interfaces/http/me.controller.js';
import { ClerkWebhookController } from './interfaces/http/clerk-webhook.controller.js';
import { ProjectsController } from './interfaces/http/projects.controller.js';
import { ProjectService } from './modules/projects/project.service.js';
import { NotesController } from './interfaces/http/notes.controller.js';
import { NoteService } from './modules/resources/note.service.js';
@Module({ controllers: [HealthController, MeController, ClerkWebhookController, ProjectsController, NotesController], providers: [Database, ClerkAuthGuard, AccountService, ProjectService, NoteService] }) export class AppModule {}
