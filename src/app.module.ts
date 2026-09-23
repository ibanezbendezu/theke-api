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
import { OrganizationController } from './interfaces/http/organization.controller.js';
import { OrganizationService } from './modules/projects/organization.service.js';
@Module({ controllers: [HealthController, MeController, ClerkWebhookController, ProjectsController, NotesController, OrganizationController], providers: [Database, ClerkAuthGuard, AccountService, ProjectService, NoteService, OrganizationService] }) export class AppModule {}
