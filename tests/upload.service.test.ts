import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { Database } from '../src/infrastructure/database/database.js';
import { accounts, memberships, resources, resourceVersions, uploads, users } from '../src/infrastructure/database/schema.js';
import { UploadQueue } from '../src/infrastructure/queue/upload.queue.js';
import { ClamAvScanner } from '../src/infrastructure/security/clamav.scanner.js';
import { S3UploadStorage } from '../src/infrastructure/storage/s3-upload.storage.js';
import { AccountService } from '../src/modules/account/account.service.js';
import { mediaTypesMatch, UploadProcessor } from '../src/modules/uploads/upload.processor.js';
import { UploadRepository } from '../src/modules/uploads/upload.repository.js';
import { UploadService } from '../src/modules/uploads/upload.service.js';

describe('política de tipos de upload', () => {
  it('acepta equivalencias seguras y rechaza discrepancias', () => { expect(mediaTypesMatch('text/markdown', 'text/plain')).toBe(true); expect(mediaTypesMatch('image/png', 'application/octet-stream')).toBe(false); });
});

const integrationEnabled = Boolean(process.env.DATABASE_URL) && process.env.RUN_UPLOAD_INTEGRATION === 'true';
const integration = describe.runIf(integrationEnabled);
integration('pipeline local de uploads', () => {
  const database = new Database(); const queue = integrationEnabled ? new UploadQueue() : undefined!; const repository = new UploadRepository(database, queue); const storage = new S3UploadStorage(); const scanner = new ClamAvScanner(); const service = new UploadService(repository, storage); const processor = new UploadProcessor(repository, storage, scanner); const accountService = new AccountService(database);
  const clerkIds = [`upload_owner_1_${crypto.randomUUID()}`, `upload_owner_2_${crypto.randomUUID()}`];
  beforeAll(() => queue.onModuleInit(), 30_000);
  afterAll(async () => {
    const createdUsers = await database.db.select({ id: users.id }).from(users).where(inArray(users.clerkUserId, clerkIds)); const userIds = createdUsers.map(value => value.id);
    if (userIds.length) { const createdAccounts = await database.db.select({ id: accounts.id }).from(accounts).where(inArray(accounts.personalOwnerUserId, userIds)); const accountIds = createdAccounts.map(value => value.id); if (accountIds.length) { const owned = await database.db.select({ id: resources.id }).from(resources).where(inArray(resources.accountId, accountIds)); const resourceIds = owned.map(value => value.id); await database.db.delete(uploads).where(inArray(uploads.accountId, accountIds)); if (resourceIds.length) { await database.db.update(resources).set({ currentVersionId: null }).where(inArray(resources.id, resourceIds)); await database.db.delete(resourceVersions).where(inArray(resourceVersions.resourceId, resourceIds)); await database.db.delete(resources).where(inArray(resources.id, resourceIds)); } } await database.db.delete(memberships).where(inArray(memberships.userId, userIds)); await database.db.delete(accounts).where(inArray(accounts.personalOwnerUserId, userIds)); await database.db.delete(users).where(inArray(users.id, userIds)); }
    await queue.onModuleDestroy(); await database.onModuleDestroy();
  }, 30_000);
  it('es idempotente, aísla cuentas y solo activa bytes limpios', async () => {
    const owner = await accountService.ensureLocalUser({ clerkUserId: clerkIds[0]! }); const outsider = await accountService.ensureLocalUser({ clerkUserId: clerkIds[1]! }); const body = Buffer.from('archivo de prueba seguro\n'); const key = crypto.randomUUID();
    const created = await service.create(owner.account.id, owner.user.id, { name: 'fuente.txt', size: body.length, mediaType: 'text/plain', idempotencyKey: key }); expect(created.uploadUrl).toBeTruthy();
    const repeated = await service.create(owner.account.id, owner.user.id, { name: 'fuente.txt', size: body.length, mediaType: 'text/plain', idempotencyKey: key }); expect(repeated.id).toBe(created.id);
    const response = await fetch(created.uploadUrl!, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body }); expect(response.ok).toBe(true);
    await service.finalize(owner.account.id, created.id, crypto.randomUUID()); await processor.process(created.id); expect((await service.get(owner.account.id, created.id)).status).toBe('ready');
    await expect(service.get(outsider.account.id, created.id)).rejects.toThrow('Carga no encontrada');
  }, 30_000);
  it('rechaza una firma de malware sin activar el recurso', async () => {
    const owner = await accountService.ensureLocalUser({ clerkUserId: clerkIds[0]! }); const body = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
    const created = await service.create(owner.account.id, owner.user.id, { name: 'muestra.txt', size: body.length, mediaType: 'text/plain', idempotencyKey: crypto.randomUUID() });
    expect((await fetch(created.uploadUrl!, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body })).ok).toBe(true); await service.finalize(owner.account.id, created.id, crypto.randomUUID()); await processor.process(created.id);
    const rejected = await service.get(owner.account.id, created.id); expect(rejected.status).toBe('rejected'); expect(rejected.failureReason).toContain('antimalware');
  }, 30_000);
});
