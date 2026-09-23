export const UPLOAD_STORAGE = Symbol('UPLOAD_STORAGE');
export const MALWARE_SCANNER = Symbol('MALWARE_SCANNER');

export interface UploadStorage {
  presignPut(key: string, mediaType: string): Promise<string>;
  head(key: string): Promise<{ size: number; mediaType: string; etag: string }>;
  copy(sourceKey: string, destinationKey: string): Promise<void>;
  read(key: string): Promise<AsyncIterable<Uint8Array>>;
  remove(key: string): Promise<void>;
}

export interface ScanResult { clean: boolean; signature?: string; sha256: string; detectedMediaType: string }
export interface MalwareScanner { scan(bytes: AsyncIterable<Uint8Array>): Promise<ScanResult> }
