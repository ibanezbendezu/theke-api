import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import type { UploadStorage } from '../../modules/uploads/upload.ports.js';

@Injectable()
export class S3UploadStorage implements UploadStorage {
  private readonly bucket = process.env.S3_BUCKET ?? 'theke';
  private readonly client = new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY ?? 'theke-local', secretAccessKey: process.env.S3_SECRET_KEY ?? 'theke-local-secret' },
  });
  presignPut(key: string, mediaType: string) { return getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: mediaType }), { expiresIn: 300 }); }
  presignGet(key: string, filename: string, mode: 'inline' | 'download') { const encoded = encodeURIComponent(filename); return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key, ResponseContentDisposition: `${mode === 'download' ? 'attachment' : 'inline'}; filename*=UTF-8''${encoded}` }), { expiresIn: 300 }); }
  async head(key: string) { const value = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })); return { size: Number(value.ContentLength ?? 0), mediaType: value.ContentType ?? 'application/octet-stream', etag: value.ETag ?? '' }; }
  async copy(sourceKey: string, destinationKey: string) { await this.client.send(new CopyObjectCommand({ Bucket: this.bucket, Key: destinationKey, CopySource: `${this.bucket}/${encodeURIComponent(sourceKey).replaceAll('%2F', '/')}` })); }
  async read(key: string) { const value = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })); if (!value.Body || !(Symbol.asyncIterator in value.Body)) throw new Error('El objeto no admite lectura en streaming.'); return value.Body as AsyncIterable<Uint8Array>; }
  async remove(key: string) { await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })); }
}
