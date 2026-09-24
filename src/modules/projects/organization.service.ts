import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { Database } from '../../infrastructure/database/database.js';
import { folders, projectResources, projects, resources } from '../../infrastructure/database/schema.js';

@Injectable()
export class OrganizationService {
  constructor(@Inject(Database) private readonly database: Database) {}
  private async project(accountId: string, projectId: string) { const [value] = await this.database.db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.accountId, accountId), isNull(projects.deletedAt))).limit(1); if (!value) throw new NotFoundException('Proyecto no encontrado.'); return value; }
  private name(value: unknown) { const name = typeof value === 'string' ? value.trim() : ''; if (!name || name.length > 120) throw new BadRequestException('El nombre debe tener entre 1 y 120 caracteres.'); return name; }
  private async folder(projectId: string, folderId: string | null | undefined) { if (!folderId) return null; const [value] = await this.database.db.select().from(folders).where(and(eq(folders.id, folderId), eq(folders.projectId, projectId))).limit(1); if (!value) throw new NotFoundException('Carpeta no encontrada.'); return value; }

  async list(accountId: string, projectId: string) {
    await this.project(accountId, projectId);
    const folderRows = await this.database.db.select().from(folders).where(eq(folders.projectId, projectId));
    const resourceRows = await this.database.db.select({ id: projectResources.id, resourceId: resources.id, folderId: projectResources.folderId, title: resources.title, description: resources.description, type: resources.type, archivedAt: resources.archivedAt, updatedAt: resources.updatedAt }).from(projectResources).innerJoin(resources, and(eq(resources.id, projectResources.resourceId), eq(resources.accountId, accountId), isNull(resources.deletedAt))).where(eq(projectResources.projectId, projectId));
    return { folders: folderRows, resources: resourceRows };
  }
  async createFolder(accountId: string, projectId: string, name: unknown, parentFolderId?: string | null) { await this.project(accountId, projectId); await this.folder(projectId, parentFolderId); const [value] = await this.database.db.insert(folders).values({ projectId, name: this.name(name), parentFolderId: parentFolderId || null }).returning(); return value!; }
  async updateFolder(accountId: string, projectId: string, id: string, input: { name?: unknown; parentFolderId?: string | null }) { await this.project(accountId, projectId); const current = await this.folder(projectId, id); if (!current) throw new NotFoundException('Carpeta no encontrada.'); if (input.parentFolderId === id) throw new BadRequestException('Una carpeta no puede contenerse a sí misma.'); if (input.parentFolderId !== undefined) await this.folder(projectId, input.parentFolderId); const [value] = await this.database.db.update(folders).set({ ...(input.name !== undefined ? { name: this.name(input.name) } : {}), ...(input.parentFolderId !== undefined ? { parentFolderId: input.parentFolderId } : {}), updatedAt: new Date() }).where(and(eq(folders.id, id), eq(folders.projectId, projectId))).returning(); return value!; }
  async archiveFolder(accountId: string, projectId: string, id: string, archived: boolean) { await this.project(accountId, projectId); const [value] = await this.database.db.update(folders).set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() }).where(and(eq(folders.id, id), eq(folders.projectId, projectId))).returning(); if (!value) throw new NotFoundException('Carpeta no encontrada.'); return value; }
  async addResources(accountId: string, projectId: string, resourceIds: string[], folderId?: string | null) {
    if (!resourceIds.length) throw new BadRequestException('Selecciona al menos un recurso.'); await this.project(accountId, projectId); await this.folder(projectId, folderId);
    const owned = await this.database.db.select({ id: resources.id }).from(resources).where(and(eq(resources.accountId, accountId), inArray(resources.id, resourceIds))); if (owned.length !== new Set(resourceIds).size) throw new NotFoundException('Recurso no encontrado.');
    await this.database.db.insert(projectResources).values([...new Set(resourceIds)].map(resourceId => ({ projectId, resourceId, folderId: folderId || null }))).onConflictDoNothing({ target: [projectResources.projectId, projectResources.resourceId] });
    return this.database.db.select().from(projectResources).where(and(eq(projectResources.projectId, projectId), inArray(projectResources.resourceId, resourceIds)));
  }
  async moveResources(accountId: string, projectId: string, resourceIds: string[], folderId?: string | null) {
    if (!resourceIds.length) throw new BadRequestException('Selecciona al menos un recurso.'); await this.project(accountId, projectId); await this.folder(projectId, folderId);
    return this.database.db.transaction(async tx => { const existing = await tx.select({ resourceId: projectResources.resourceId }).from(projectResources).where(and(eq(projectResources.projectId, projectId), inArray(projectResources.resourceId, resourceIds))); if (existing.length !== new Set(resourceIds).size) throw new NotFoundException('Referencia de recurso no encontrada.'); return tx.update(projectResources).set({ folderId: folderId || null, updatedAt: new Date() }).where(and(eq(projectResources.projectId, projectId), inArray(projectResources.resourceId, resourceIds))).returning(); });
  }
}
