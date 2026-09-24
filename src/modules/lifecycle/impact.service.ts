import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { Database } from '../../infrastructure/database/database.js';
import { folders, operationReceipts, projectResources, projects, resources } from '../../infrastructure/database/schema.js';

export type ImpactEntityType = 'resource' | 'project' | 'folder';
export type ImpactAction = 'archive' | 'delete';
type Executor = Pick<Database['db'], 'select' | 'update' | 'insert'>;
export interface Impact { entityType: ImpactEntityType; entityId: string; entityName: string; action: ImpactAction; state: string; affected: { projects: number; folders: number; resources: number; placements: number }; locations: string[]; consequences: string[]; recommendedAction: 'archive' | null; deletionAllowed: boolean; confirmationPhrase: string; impactVersion: string }

const version = (value: Omit<Impact, 'impactVersion'>) => createHash('sha256').update(JSON.stringify(value)).digest('base64url');
const withVersion = (value: Omit<Impact, 'impactVersion'>): Impact => ({ ...value, impactVersion: version(value) });

@Injectable()
export class ImpactService {
  constructor(@Inject(Database) private readonly database: Database) {}

  private async calculate(executor: Executor, accountId: string, entityType: ImpactEntityType, id: string, action: ImpactAction): Promise<Impact> {
    if (entityType === 'resource') {
      const [resource] = await executor.select({ id: resources.id, title: resources.title, archivedAt: resources.archivedAt }).from(resources).where(and(eq(resources.id, id), eq(resources.accountId, accountId), isNull(resources.deletedAt))).limit(1);
      if (!resource) throw new NotFoundException('Recurso no encontrado.');
      const placements = await executor.select({ id: projectResources.id, projectId: projects.id, projectName: projects.name, folderName: folders.name }).from(projectResources).innerJoin(projects, and(eq(projects.id, projectResources.projectId), eq(projects.accountId, accountId), isNull(projects.deletedAt))).leftJoin(folders, eq(folders.id, projectResources.folderId)).where(eq(projectResources.resourceId, id));
      placements.sort((a, b) => a.id.localeCompare(b.id)); const projectCount = new Set(placements.map(item => item.projectId)).size; const locations = placements.map(item => `${item.projectName}${item.folderName ? ` / ${item.folderName}` : ''}`);
      const deletionAllowed = placements.length === 0; const value: Omit<Impact, 'impactVersion'> = { entityType, entityId: id, entityName: resource.title, action, state: resource.archivedAt ? 'archived' : 'active', affected: { projects: projectCount, folders: new Set(placements.map(item => item.folderName).filter(Boolean)).size, resources: 1, placements: placements.length }, locations, consequences: action === 'archive' ? ['El Recurso dejará de aparecer en la Biblioteca activa.', placements.length ? 'Sus usos existentes conservarán la identidad y mostrarán que está archivado.' : 'Podrás restaurarlo durante la retención.'] : deletionAllowed ? ['El Recurso desaparecerá de los sistemas activos y quedará recuperable durante 30 días.'] : ['Sus referencias en Proyectos dejarían de funcionar.', 'Archívalo para conservar sus usos existentes.'], recommendedAction: action === 'delete' && !deletionAllowed ? 'archive' : null, deletionAllowed, confirmationPhrase: `${action === 'delete' ? 'ELIMINAR' : 'ARCHIVAR'} ${resource.title}` };
      return withVersion(value);
    }
    if (entityType === 'project') {
      const [project] = await executor.select({ id: projects.id, name: projects.name, archivedAt: projects.archivedAt }).from(projects).where(and(eq(projects.id, id), eq(projects.accountId, accountId), isNull(projects.deletedAt))).limit(1);
      if (!project) throw new NotFoundException('Proyecto no encontrado.');
      const folderRows = await executor.select({ id: folders.id }).from(folders).where(eq(folders.projectId, id)); const placements = await executor.select({ id: projectResources.id, resourceId: projectResources.resourceId }).from(projectResources).where(eq(projectResources.projectId, id));
      const value: Omit<Impact, 'impactVersion'> = { entityType, entityId: id, entityName: project.name, action, state: project.archivedAt ? 'archived' : 'active', affected: { projects: 1, folders: folderRows.length, resources: new Set(placements.map(item => item.resourceId)).size, placements: placements.length }, locations: [], consequences: action === 'archive' ? ['El Proyecto dejará de aparecer entre los activos y podrá restaurarse.'] : ['El Proyecto y su organización desaparecerán de los sistemas activos durante 30 días.', 'Los Recursos canónicos permanecerán intactos en la Biblioteca y otros Proyectos.'], recommendedAction: null, deletionAllowed: true, confirmationPhrase: `${action === 'delete' ? 'ELIMINAR' : 'ARCHIVAR'} ${project.name}` };
      return withVersion(value);
    }
    const [folder] = await executor.select({ id: folders.id, name: folders.name, archivedAt: folders.archivedAt }).from(folders).innerJoin(projects, and(eq(projects.id, folders.projectId), eq(projects.accountId, accountId), isNull(projects.deletedAt))).where(eq(folders.id, id)).limit(1);
    if (!folder) throw new NotFoundException('Carpeta no encontrada.');
    const placements = await executor.select({ id: projectResources.id }).from(projectResources).where(eq(projectResources.folderId, id)); const children = await executor.select({ id: folders.id }).from(folders).where(eq(folders.parentFolderId, id)); const deletionAllowed = false;
    return withVersion({ entityType, entityId: id, entityName: folder.name, action, state: folder.archivedAt ? 'archived' : 'active', affected: { projects: 1, folders: 1 + children.length, resources: placements.length, placements: placements.length }, locations: [], consequences: action === 'archive' ? ['La Carpeta dejará de aparecer en la organización activa y podrá restaurarse.', 'Los Recursos canónicos no se modifican.'] : ['La eliminación definitiva de Carpetas no está habilitada; archívala para conservar su organización.'], recommendedAction: action === 'delete' ? 'archive' : null, deletionAllowed, confirmationPhrase: `${action === 'delete' ? 'ELIMINAR' : 'ARCHIVAR'} ${folder.name}` });
  }

  async get(accountId: string, entityType: ImpactEntityType, id: string, action: ImpactAction) { if (!['resource', 'project', 'folder'].includes(entityType) || !['archive', 'delete'].includes(action)) throw new BadRequestException('La entidad o acción no es válida.'); return this.calculate(this.database.db, accountId, entityType, id, action); }

  async execute(accountId: string, entityType: ImpactEntityType, id: string, input: { action?: unknown; impactVersion?: unknown; confirmation?: unknown; idempotencyKey?: unknown }) {
    if (!['resource', 'project', 'folder'].includes(entityType)) throw new BadRequestException('La entidad no es válida.'); const action = input.action; if (action !== 'archive' && action !== 'delete') throw new BadRequestException('La acción no es válida.'); if (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim() || input.idempotencyKey.length > 120) throw new BadRequestException('Falta la clave de idempotencia.');
    return this.database.db.transaction(async tx => {
      const [receipt] = await tx.select({ result: operationReceipts.result, entityType: operationReceipts.entityType, entityId: operationReceipts.entityId, action: operationReceipts.action }).from(operationReceipts).where(and(eq(operationReceipts.accountId, accountId), eq(operationReceipts.idempotencyKey, input.idempotencyKey as string))).limit(1); if (receipt) { if (receipt.entityType !== entityType || receipt.entityId !== id || receipt.action !== action) throw new ConflictException('La clave de idempotencia ya fue utilizada para otra operación.'); return receipt.result; }
      if (entityType === 'resource') await tx.select({ id: resources.id }).from(resources).where(and(eq(resources.id, id), eq(resources.accountId, accountId))).for('update'); else if (entityType === 'project') await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.id, id), eq(projects.accountId, accountId))).for('update'); else await tx.select({ id: folders.id }).from(folders).innerJoin(projects, and(eq(projects.id, folders.projectId), eq(projects.accountId, accountId))).where(eq(folders.id, id)).for('update');
      const current = await this.calculate(tx, accountId, entityType, id, action); if (current.impactVersion !== input.impactVersion) throw new ConflictException({ message: 'El impacto cambió. Revísalo y confirma nuevamente.', details: { impact: current } }); if (input.confirmation !== current.confirmationPhrase) throw new BadRequestException('La confirmación escrita no coincide.'); if (action === 'delete' && !current.deletionAllowed) throw new BadRequestException('La eliminación no está habilitada para este impacto.');
      const now = new Date(); const purgeAfter = new Date(now.getTime() + 30 * 86_400_000); if (entityType === 'resource') await tx.update(resources).set(action === 'archive' ? { archivedAt: now, updatedAt: now } : { archivedAt: now, deletedAt: now, purgeAfter, updatedAt: now }).where(and(eq(resources.id, id), eq(resources.accountId, accountId))); else if (entityType === 'project') await tx.update(projects).set(action === 'archive' ? { archivedAt: now, updatedAt: now } : { archivedAt: now, deletedAt: now, purgeAfter, updatedAt: now }).where(and(eq(projects.id, id), eq(projects.accountId, accountId))); else await tx.update(folders).set({ archivedAt: now, updatedAt: now }).where(eq(folders.id, id));
      const result = { ...current, state: action === 'delete' ? 'pending-deletion' : 'archived', ...(action === 'delete' ? { purgeAfter: purgeAfter.toISOString() } : {}) }; await tx.insert(operationReceipts).values({ accountId, idempotencyKey: input.idempotencyKey as string, entityType, entityId: id, action, result }); return result;
    }, { isolationLevel: 'serializable' });
  }
}
