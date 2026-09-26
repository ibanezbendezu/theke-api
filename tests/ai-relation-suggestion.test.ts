import { afterEach, describe, expect, it, vi } from 'vitest';
import { RelationSuggestionService } from '../src/modules/ai/relation-suggestion.service.js';

const sourceId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const relationId = '33333333-3333-4333-8333-333333333333';
const relation = { sourceResourceId: sourceId, targetResourceId: targetId };
const scoped = [
  { id: sourceId, title: 'Origen', type: 'note', content: 'Prueba concreta del origen.', accessibilityText: null, linkMetadataStatus: null },
  { id: targetId, title: 'Destino', type: 'note', content: 'Detalle del destino.', accessibilityText: null, linkMetadataStatus: null },
];

function setup() {
  vi.stubEnv('AI_PROVIDER_ENABLED', 'true');
  const select = vi.fn()
    .mockImplementationOnce(() => ({ from: () => ({ where: () => ({ limit: async () => [relation] }) }) }))
    .mockImplementationOnce(() => ({ from: () => ({ leftJoin: () => ({ leftJoin: () => ({ leftJoin: () => ({ where: async () => scoped }) }) }) }) }));
  const database = { db: { select, insert: vi.fn(), update: vi.fn(), delete: vi.fn() } };
  const ai = { getStatus: vi.fn().mockResolvedValue({ quota: { maxOutputTokens: 4000 } }), preflightCheck: vi.fn().mockResolvedValue({ allowed: true, maxInputTokens: 50000 }), recordUsage: vi.fn().mockResolvedValue(undefined) };
  const service = new RelationSuggestionService(database as never, ai as never);
  return { service, database, ai };
}

function response(evidence: unknown = [{ resourceId: sourceId, excerpt: 'Prueba concreta' }]) {
  return { ok: true, json: async () => ({ status: 'completed', model: 'gpt-5.6-terra', usage: { input_tokens: 120, output_tokens: 60 }, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ direction: 'directed', typeKey: 'supports', label: 'Apoya', explanation: 'La evidencia apoya la relación.', uncertainty: 'Interpretación provisional.', evidence }) }] }] }) };
}

describe('sugerencias de relaciones de IA', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('bloquea aun con clave y consentimiento antes de consultar datos o llamar al proveedor', async () => {
    const { service, database, ai } = setup();
    vi.stubEnv('AI_PROVIDER_ENABLED', 'false');
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(service.suggest('account', 'user', { relationId })).rejects.toMatchObject({ response: { errorCode: 'PROVIDER_PENDING' } });
    expect(fetch).not.toHaveBeenCalled();
    expect(database.db.select).not.toHaveBeenCalled();
    expect(ai.recordUsage).not.toHaveBeenCalled();
  });

  it('rechaza sin consentimiento y no envía información al proveedor', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const { service, ai, database } = setup();
    ai.preflightCheck.mockResolvedValue({ allowed: false, errorCode: 'CONSENT_REQUIRED', reason: 'Consentimiento requerido' });
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(service.suggest('account', 'user', { relationId })).rejects.toThrow('Consentimiento requerido');
    expect(fetch).not.toHaveBeenCalled();
    expect(database.db.insert).not.toHaveBeenCalled();
  });

  it('rechaza una cita inventada y registra consumo fallido', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const { service, ai, database } = setup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([{ resourceId: sourceId, excerpt: 'texto inventado' }])));
    await expect(service.suggest('account', 'user', { relationId })).rejects.toThrow();
    expect(ai.recordUsage).toHaveBeenCalledWith('account', 'user', 'relation_suggestion', 120, 60, 'failed');
    expect(database.db.update).not.toHaveBeenCalled();
  });

  it('rechaza relaciones ajenas o archivadas antes de consultar recursos', async () => {
    const { service, database, ai } = setup();
    const select = database.db.select as ReturnType<typeof vi.fn>;
    select.mockReset().mockImplementation(() => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }));
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(service.suggest('account', 'user', { relationId })).rejects.toThrow('Relación no encontrada');
    expect(select).toHaveBeenCalledTimes(1);
    expect(ai.preflightCheck).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rechaza sin clave antes de enviar los textos', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const { service, ai } = setup();
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(service.suggest('account', 'user', { relationId })).rejects.toThrow('no está configurada');
    expect(fetch).not.toHaveBeenCalled();
    expect(ai.recordUsage).not.toHaveBeenCalled();
  });

  it('rechaza citas de terceros aunque el fragmento aparezca en un recurso permitido', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const { service, ai } = setup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([{ resourceId: '44444444-4444-4444-8444-444444444444', excerpt: 'Prueba concreta' }])));
    await expect(service.suggest('account', 'user', { relationId })).rejects.toThrow('no coincide');
    expect(ai.recordUsage).toHaveBeenCalledWith('account', 'user', 'relation_suggestion', 120, 60, 'failed');
  });

  it('respeta el límite de salida configurado para la cuenta', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const { service, ai } = setup();
    ai.getStatus.mockResolvedValue({ quota: { maxOutputTokens: 500 } });
    const fetch = vi.fn().mockResolvedValue(response()); vi.stubGlobal('fetch', fetch);
    await service.suggest('account', 'user', { relationId });
    expect(JSON.parse(fetch.mock.calls[0]![1].body).max_output_tokens).toBe(500);
    expect(ai.preflightCheck).toHaveBeenCalledWith('account', 'user', { resourceIds: [sourceId, targetId], expectedOutputTokens: 500 });
  });

  it('entrega la sugerencia sin mutar la relación y envía solo los dos recursos', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const { service, ai, database } = setup();
    const fetch = vi.fn().mockResolvedValue(response()); vi.stubGlobal('fetch', fetch);
    const suggestion = await service.suggest('account', 'user', { relationId });
    expect(suggestion).toMatchObject({ sourceResourceId: sourceId, targetResourceId: targetId, direction: 'directed', typeKey: 'supports', evidence: [{ resourceId: sourceId, excerpt: 'Prueba concreta' }], provider: 'openai', model: 'gpt-5.6-terra' });
    expect(suggestion.createdAt).toEqual(expect.any(String));
    const request = JSON.parse(fetch.mock.calls[0]![1].body);
    expect(request).toMatchObject({ model: 'gpt-5.6-terra', store: false, reasoning: { effort: 'medium' } });
    expect(request.input).toContain(sourceId);
    expect(request.input).toContain(targetId);
    expect(ai.preflightCheck).toHaveBeenCalledWith('account', 'user', { resourceIds: [sourceId, targetId], expectedOutputTokens: request.max_output_tokens });
    expect(ai.recordUsage).toHaveBeenCalledWith('account', 'user', 'relation_suggestion', 120, 60, 'success');
    expect(database.db.update).not.toHaveBeenCalled();
    expect(database.db.delete).not.toHaveBeenCalled();
  });
});
