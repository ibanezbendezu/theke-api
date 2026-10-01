import { afterEach, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { PublicSharesController } from '../src/interfaces/http/public-shares.controller.js';

afterEach(() => vi.unstubAllEnvs());

it('exige origen y JSON antes de crear un comentario, y solo emite cookie tras publicar', async () => {
  vi.stubEnv('WEB_ORIGINS', 'https://app.example');
  const create = vi.fn().mockResolvedValue({ comment: { id: 'one' }, session: 'new-session' });
  const cookieHeader = vi.fn().mockReturnValue('cookie=value; HttpOnly; Secure');
  const controller = new PublicSharesController({} as never, { create, cookieHeader } as never, {} as never);
  const response = { header: vi.fn() };
  const request = { headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, ip: '127.0.0.1', log: { warn: vi.fn() } };
  await expect(controller.createComment('token', { content: 'texto' }, request as never, undefined, response)).rejects.toMatchObject({ status: 403 });
  expect(create).not.toHaveBeenCalled();
  request.headers.origin = 'https://app.example'; request.headers['content-type'] = 'text/plain';
  await expect(controller.createComment('token', { content: 'texto' }, request as never, undefined, response)).rejects.toMatchObject({ status: 415 });
  expect(create).not.toHaveBeenCalled();
  request.headers['content-type'] = 'application/json';
  expect(await controller.createComment('token', { content: 'texto' }, request as never, undefined, response)).toEqual({ data: { id: 'one' } });
  expect(response.header).toHaveBeenCalledWith('Set-Cookie', 'cookie=value; HttpOnly; Secure');
});

it('señala el límite sin registrar el contenido y entrega Retry-After', async () => {
  vi.stubEnv('WEB_ORIGINS', 'https://app.example');
  const create = vi.fn().mockRejectedValue(new HttpException('Límite', 429));
  const controller = new PublicSharesController({} as never, { create } as never, {} as never);
  const response = { header: vi.fn() };
  const request = { headers: { origin: 'https://app.example', 'content-type': 'application/json' }, ip: '127.0.0.1', log: { warn: vi.fn() } };
  await expect(controller.createComment('token', { content: 'contenido privado' }, request as never, undefined, response)).rejects.toMatchObject({ status: 429 });
  expect(response.header).toHaveBeenCalledWith('Retry-After', '60');
  expect(request.log.warn.mock.calls[0]?.[0]).toEqual({ event: 'public_comment_rate_limited', policyVersion: '2026-09-pilot-1' });
});

it('protege la edición con Origin y JSON, y no emite una cookie nueva', async () => {
  vi.stubEnv('WEB_ORIGINS', 'https://app.example');
  const edit = vi.fn().mockResolvedValue({ id: 'comment-1', revision: 2, content: 'Editado' });
  const controller = new PublicSharesController({} as never, { edit } as never, {} as never);
  const response = { header: vi.fn() };
  const request = { headers: { origin: 'https://wrong.example', 'content-type': 'application/json', cookie: 'signed-cookie', 'x-csrf-token': 'csrf' }, ip: '127.0.0.1', log: { warn: vi.fn() } };
  await expect(controller.editComment('share-token', 'comment-1', { content: 'Editado', expectedRevision: 1 }, request as never, undefined, response)).rejects.toMatchObject({ status: 403 });
  expect(edit).not.toHaveBeenCalled();
  request.headers.origin = 'https://app.example';
  expect(await controller.editComment('share-token', 'comment-1', { content: 'Editado', expectedRevision: 1 }, request as never, undefined, response)).toEqual({ data: { id: 'comment-1', revision: 2, content: 'Editado' } });
  expect(edit).toHaveBeenCalledWith('share-token', 'comment-1', { content: 'Editado', expectedRevision: 1 }, 'signed-cookie', 'csrf', '127.0.0.1', undefined);
  expect(response.header).not.toHaveBeenCalledWith('Set-Cookie', expect.anything());
});
