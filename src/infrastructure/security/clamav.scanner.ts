import { createHash } from 'node:crypto';
import { createConnection } from 'node:net';
import { Injectable } from '@nestjs/common';
import type { MalwareScanner, ScanResult } from '../../modules/uploads/upload.ports.js';

function mediaType(bytes: Buffer): string {
  const ascii = bytes.toString('ascii');
  if (ascii.startsWith('MZ') || bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return 'application/x-executable';
  if (bytes.subarray(0, 4).equals(Buffer.from('%PDF'))) return 'application/pdf';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (ascii.startsWith('GIF8')) return 'image/gif';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE') return 'audio/wav';
  if (ascii.startsWith('OggS')) return 'audio/ogg';
  if (ascii.startsWith('ID3') || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (ascii.slice(4, 8) === 'ftyp') return 'video/mp4';
  if (bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'video/webm';
  if (bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return 'application/zip';
  if (!bytes.includes(0)) { try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return 'text/plain'; } catch { /* binary */ } }
  return 'application/octet-stream';
}
function write(socket: ReturnType<typeof createConnection>, data: Uint8Array) { return new Promise<void>((resolve, reject) => { const ready = socket.write(data, error => error ? reject(error) : resolve()); if (!ready) socket.once('drain', resolve); }); }

@Injectable()
export class ClamAvScanner implements MalwareScanner {
  async scan(bytes: AsyncIterable<Uint8Array>): Promise<ScanResult> {
    const socket = createConnection({ host: process.env.CLAMAV_HOST ?? '127.0.0.1', port: Number(process.env.CLAMAV_PORT ?? 3310) });
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
    const response = new Promise<string>((resolve, reject) => { let value = ''; socket.on('data', chunk => { value += chunk.toString(); if (value.includes('\0')) resolve(value); }); socket.once('error', reject); socket.once('timeout', () => reject(new Error('ClamAV no respondió.'))); });
    socket.setTimeout(300_000); await write(socket, Buffer.from('zINSTREAM\0'));
    const hash = createHash('sha256'); const header: Buffer[] = []; let headerSize = 0;
    for await (const chunk of bytes) { const data = Buffer.from(chunk); hash.update(data); if (headerSize < 4096) { const part = data.subarray(0, 4096 - headerSize); header.push(part); headerSize += part.length; } const length = Buffer.alloc(4); length.writeUInt32BE(data.length); await write(socket, length); await write(socket, data); }
    await write(socket, Buffer.alloc(4)); const result = await response; socket.end();
    if (result.includes('ERROR')) throw new Error(`ClamAV no pudo completar el análisis: ${result.replaceAll('\0', '').trim()}`);
    const clean = result.includes('OK'); const signature = clean ? undefined : result.match(/stream: (.+) FOUND/)?.[1] ?? result.replaceAll('\0', '').trim();
    return { clean, signature, sha256: hash.digest('hex'), detectedMediaType: mediaType(Buffer.concat(header)) };
  }
}
