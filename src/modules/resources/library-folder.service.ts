import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { Database } from '../../infrastructure/database/database.js';
import { libraryFolders, resources } from '../../infrastructure/database/schema.js';

@Injectable()
export class LibraryFolderService {
  constructor(@Inject(Database) private readonly database: Database) {}
  private name(value: unknown) { const name = typeof value === 'string' ? value.trim() : ''; if (!name || name.length > 120) throw new BadRequestException('El nombre debe tener entre 1 y 120 caracteres.'); return name; }
  private async owned(accountId: string, id: string) { const [folder] = await this.database.db.select().from(libraryFolders).where(and(eq(libraryFolders.id, id), eq(libraryFolders.accountId, accountId))); if (!folder) throw new NotFoundException('Carpeta no encontrada.'); return folder; }
  async list(accountId: string) { return this.database.db.select().from(libraryFolders).where(eq(libraryFolders.accountId, accountId)); }
  async create(accountId: string, value: unknown) {
    const name = this.name(value);
    const [folder] = await this.database.db.insert(libraryFolders).values({ accountId, name }).onConflictDoNothing({ target: [libraryFolders.accountId, libraryFolders.name] }).returning();
    if (!folder) throw new ConflictException('Ya existe una carpeta con ese nombre.');
    return folder;
  }
  async rename(accountId: string, id: string, value: unknown) { await this.owned(accountId, id); const name = this.name(value); try { const [folder] = await this.database.db.update(libraryFolders).set({ name, updatedAt: new Date() }).where(and(eq(libraryFolders.id, id), eq(libraryFolders.accountId, accountId))).returning(); return folder!; } catch (error) { if ((error as { code?: string })?.code === '23505') throw new ConflictException('Ya existe una carpeta con ese nombre.'); throw error; } }
  async remove(accountId: string, id: string) { await this.owned(accountId, id); await this.database.db.transaction(async tx => { await tx.update(resources).set({ libraryFolderId: null, updatedAt: new Date() }).where(and(eq(resources.accountId, accountId), eq(resources.libraryFolderId, id))); await tx.delete(libraryFolders).where(and(eq(libraryFolders.accountId, accountId), eq(libraryFolders.id, id))); }); return { id }; }
  async move(accountId: string, resourceIds: string[], folderId: string | null) {
    if (!resourceIds.length || resourceIds.length > 100 || new Set(resourceIds).size !== resourceIds.length) throw new BadRequestException('Selecciona entre 1 y 100 recursos diferentes.');
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (resourceIds.some(id => !uuid.test(id)) || (folderId !== null && !uuid.test(folderId))) throw new BadRequestException('Identificador no válido.');
    if (folderId) await this.owned(accountId, folderId);
    return this.database.db.transaction(async tx => { const owned = await tx.select({ id: resources.id }).from(resources).where(and(eq(resources.accountId, accountId), eq(resources.type, 'file'), isNull(resources.deletedAt), inArray(resources.id, resourceIds))).for('update'); if (owned.length !== resourceIds.length) throw new NotFoundException('Archivo no encontrado.'); return tx.update(resources).set({ libraryFolderId: folderId, updatedAt: new Date() }).where(and(eq(resources.accountId, accountId), inArray(resources.id, resourceIds))).returning({ id: resources.id, libraryFolderId: resources.libraryFolderId }); });
  }
}
