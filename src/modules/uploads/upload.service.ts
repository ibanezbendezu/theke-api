import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { UploadRepository } from './upload.repository.js';
import { UPLOAD_STORAGE, type UploadStorage } from './upload.ports.js';

export const MAX_FILE_SIZE = 250 * 1024 * 1024;
export const MAX_BATCH_SIZE = 20;
export const ACCOUNT_QUOTA = 5 * 1024 * 1024 * 1024;
const SAFE_TYPES = new Set(['text/plain', 'text/markdown', 'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'video/mp4', 'video/webm', 'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.oasis.opendocument.text', 'application/octet-stream']);
const SAFE_EXTENSIONS = new Set(['txt', 'md', 'pdf', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'mp3', 'm4a', 'aac', 'ogg', 'wav', 'mp4', 'webm', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt']);

function intent(input: { name?: unknown; size?: unknown; mediaType?: unknown; idempotencyKey?: unknown }) {
  const name = typeof input.name === 'string' ? input.name.trim() : ''; const size = Number(input.size); const mediaType = typeof input.mediaType === 'string' ? input.mediaType.toLowerCase().trim() : ''; const idempotencyKey = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  if (!name || name.length > 160) throw new BadRequestException('El nombre del archivo no es válido.');
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_FILE_SIZE) throw new BadRequestException('El archivo supera el límite de 250 MiB o está vacío.');
  if (!SAFE_EXTENSIONS.has(extension) || !SAFE_TYPES.has(mediaType)) throw new BadRequestException('El tipo de archivo no está admitido.');
  if (!idempotencyKey || idempotencyKey.length > 120) throw new BadRequestException('Falta una clave idempotente válida.');
  return { name, size, mediaType, idempotencyKey };
}

@Injectable()
export class UploadService {
  constructor(@Inject(UploadRepository) private readonly repository: UploadRepository, @Inject(UPLOAD_STORAGE) private readonly storage: UploadStorage) {}
  policy() { return { maxBatchSize: MAX_BATCH_SIZE, maxFileSize: MAX_FILE_SIZE, accountQuota: ACCOUNT_QUOTA, allowedMediaTypes: [...SAFE_TYPES] }; }
  private view(upload: NonNullable<Awaited<ReturnType<UploadRepository['get']>>>, uploadUrl?: string) { return { id: upload.id, resourceId: upload.resourceId, name: upload.originalName, size: upload.declaredSize, mediaType: upload.declaredMediaType, status: upload.status, failureReason: upload.failureReason, createdAt: upload.createdAt, updatedAt: upload.updatedAt, ...(uploadUrl ? { uploadUrl } : {}) }; }
  async list(accountId: string) { return Promise.all((await this.repository.list(accountId)).map(upload => this.view(upload))); }
  async get(accountId: string, id: string) { const upload = await this.repository.get(accountId, id); if (!upload) throw new NotFoundException('Carga no encontrada.'); return this.view(upload); }
  async create(accountId: string, authorUserId: string, input: Parameters<typeof intent>[0]) {
    const value = intent(input); const existing = await this.repository.findByKey(accountId, value.idempotencyKey);
    if (existing) return this.view(existing, existing.status === 'initiated' ? await this.storage.presignPut(existing.quarantineKey, existing.declaredMediaType) : undefined);
    if (await this.repository.reservedBytes(accountId) + value.size > ACCOUNT_QUOTA) throw new ConflictException('La carga supera la cuota de 5 GiB de la cuenta.');
    const uploadId = crypto.randomUUID(); const resourceId = crypto.randomUUID(); const quarantineKey = `quarantine/${accountId}/${uploadId}`;
    try { const upload = await this.repository.create({ accountId, authorUserId, idempotencyKey: value.idempotencyKey, originalName: value.name, mediaType: value.mediaType, size: value.size, uploadId, resourceId, quarantineKey }); return this.view(upload, await this.storage.presignPut(quarantineKey, value.mediaType)); }
    catch (error) { const concurrent = await this.repository.findByKey(accountId, value.idempotencyKey); if (concurrent) return this.view(concurrent, concurrent.status === 'initiated' ? await this.storage.presignPut(concurrent.quarantineKey, concurrent.declaredMediaType) : undefined); throw error; }
  }
  async finalize(accountId: string, id: string, requestId: string) {
    const upload = await this.repository.claimFinalize(accountId, id); if (!upload) throw new NotFoundException('Carga no encontrada.'); if (upload.status !== 'finalizing') return this.view(upload);
    const snapshotKey = `snapshots/${accountId}/${id}`;
    try { const source = await this.storage.head(upload.quarantineKey); if (source.size !== upload.declaredSize) throw new Error('El tamaño transferido no coincide con el declarado.'); await this.storage.copy(upload.quarantineKey, snapshotKey); const snapshot = await this.storage.head(snapshotKey); if (snapshot.size !== upload.declaredSize) throw new Error('No se pudo fijar el snapshot de cuarentena.'); const completed = await this.repository.finalize(accountId, id, { snapshotKey, etag: snapshot.etag }, requestId); if (!completed) throw new Error('La carga ya no puede finalizarse.'); await this.storage.remove(upload.quarantineKey).catch(() => undefined); return this.view(completed); }
    catch (error) { await Promise.all([this.storage.remove(upload.quarantineKey).catch(() => undefined), this.storage.remove(snapshotKey).catch(() => undefined)]); const reason = error instanceof Error ? error.message : 'No se pudo confirmar la transferencia.'; await this.repository.setFailure(id, 'failed', reason); throw new BadRequestException(reason); }
  }
  async cancel(accountId: string, id: string) { const upload = await this.repository.cancel(accountId, id); if (!upload) throw new ConflictException('La carga ya no puede cancelarse.'); await this.storage.remove(upload.quarantineKey).catch(() => undefined); return this.view(upload); }
}
