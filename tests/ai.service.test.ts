import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { Database } from '../src/infrastructure/database/database.js';
import { accountAiSettings, accounts, aiUsageRecords, memberships, resources, resourceVersions, users } from '../src/infrastructure/database/schema.js';
import { AccountService } from '../src/modules/account/account.service.js';
import { NoteService } from '../src/modules/resources/note.service.js';
import { ResourceKnowledgeRepository } from '../src/modules/resources/resource-knowledge.repository.js';
import { AiService } from '../src/modules/ai/ai.service.js';
import { BASELINE_AI_POLICY, CURRENT_AI_CONSENT_VERSION } from '../src/modules/ai/ai.types.js';

describe('políticas y baseline de gobernanza de IA', () => {
  it('establece modelo seguro gpt-5.6-terra sin retención permanente ni entrenamiento', () => {
    expect(CURRENT_AI_CONSENT_VERSION).toBe('2026-09-25.1');
    expect(BASELINE_AI_POLICY.provider).toBe('openai');
    expect(BASELINE_AI_POLICY.model).toBe('gpt-5.6-terra');
    expect(BASELINE_AI_POLICY.store).toBe(false);
    expect(BASELINE_AI_POLICY.reasoningEffort).toBe('medium');
    expect(BASELINE_AI_POLICY.trainModels).toBe(false);
    expect(BASELINE_AI_POLICY.retentionDays).toBe(30);
  });
});

describe.runIf(Boolean(process.env.DATABASE_URL))('gobernanza de IA y control de cuotas con PostgreSQL', () => {
  const database = new Database();
  const accountService = new AccountService(database);
  const aiService = new AiService(database);
  const noteService = new NoteService(database, new ResourceKnowledgeRepository(database));

  const clerkId = `ai_test_${crypto.randomUUID()}`;
  let accountId = '';
  let userId = '';

  afterAll(async () => {
    if (accountId) {
      await database.db.delete(aiUsageRecords).where(eq(aiUsageRecords.accountId, accountId));
      await database.db.delete(accountAiSettings).where(eq(accountAiSettings.accountId, accountId));
      const ownedResources = await database.db.select({ id: resources.id }).from(resources).where(eq(resources.accountId, accountId));
      for (const res of ownedResources) {
        await database.db.update(resources).set({ currentVersionId: null }).where(eq(resources.id, res.id));
        await database.db.delete(resourceVersions).where(eq(resourceVersions.resourceId, res.id));
        await database.db.delete(resources).where(eq(resources.id, res.id));
      }
      await database.db.delete(memberships).where(eq(memberships.userId, userId));
      await database.db.delete(accounts).where(eq(accounts.id, accountId));
      await database.db.delete(users).where(eq(users.id, userId));
    }
    await database.onModuleDestroy();
  });

  it('informa estado inicial sin consentimiento y bloquea preflight', async () => {
    const owner = await accountService.ensureLocalUser({ clerkUserId: clerkId });
    accountId = owner.account.id;
    userId = owner.user.id;

    const initialStatus = await aiService.getStatus(accountId);
    expect(initialStatus.enabled).toBe(false);
    expect(initialStatus.consent.isConsented).toBe(false);
    expect(initialStatus.consent.required).toBe(true);
    expect(initialStatus.consent.currentVersion).toBe(CURRENT_AI_CONSENT_VERSION);
    expect(initialStatus.consent.policy.store).toBe(false);
    expect(initialStatus.consent.policy.model).toBe('gpt-5.6-terra');
    expect(initialStatus.quota.dailyRuns.remaining).toBe(10);
    expect(initialStatus.quota.monthlyBudget.remainingUsd).toBe(5);

    const blocked = await aiService.preflightCheck(accountId, userId, { resourceIds: ['00000000-0000-0000-0000-000000000000'] });
    expect(blocked.allowed).toBe(false);
    expect(blocked.errorCode).toBe('AI_DISABLED');
  });

  it('valida consentimiento versionado, permite activar/desactivar y revocar', async () => {
    await expect(aiService.updateConsent(accountId, userId, { consentVersion: '1999-01-01' })).rejects.toThrow();

    const consented = await aiService.updateConsent(accountId, userId, { consentVersion: CURRENT_AI_CONSENT_VERSION });
    expect(consented.enabled).toBe(true);
    expect(consented.consent.isConsented).toBe(true);
    expect(consented.consent.acceptedVersion).toBe(CURRENT_AI_CONSENT_VERSION);
    expect(consented.consent.required).toBe(false);

    const toggledOff = await aiService.updateSettings(accountId, { enabled: false });
    expect(toggledOff.enabled).toBe(false);
    expect(toggledOff.consent.isConsented).toBe(true);

    const toggledOn = await aiService.updateSettings(accountId, { enabled: true });
    expect(toggledOn.enabled).toBe(true);

    const revoked = await aiService.revokeConsent(accountId);
    expect(revoked.enabled).toBe(false);
    expect(revoked.consent.isConsented).toBe(false);
    expect(revoked.consent.required).toBe(true);

    await expect(aiService.updateSettings(accountId, { enabled: true })).rejects.toThrow('No se puede activar la asistencia de IA sin otorgar consentimiento');
  });

  it('ejecuta preflight check verificando recursos, tokens y cuotas', async () => {
    await aiService.updateConsent(accountId, userId, { consentVersion: CURRENT_AI_CONSENT_VERSION });

    const note1 = await noteService.create(accountId, userId, { title: 'Nota 1', content: 'Contenido breve para análisis' });
    const note2 = await noteService.create(accountId, userId, { title: 'Nota 2', content: 'Segundo contenido explicativo' });

    const preflight = await aiService.preflightCheck(accountId, userId, { resourceIds: [note1.id, note2.id] });
    expect(preflight.allowed).toBe(true);
    expect(preflight.resources).toHaveLength(2);
    expect(preflight.resources[0].valid).toBe(true);
    expect(preflight.totalEstimatedInputTokens).toBeGreaterThan(0);

    const invalidCheck = await aiService.preflightCheck(accountId, userId, { resourceIds: [note1.id, '00000000-0000-0000-0000-000000000000'] });
    expect(invalidCheck.allowed).toBe(false);
    expect(invalidCheck.errorCode).toBe('INVALID_RESOURCE');

    // Registrar 10 ejecuciones para agotar límite diario
    for (let i = 0; i < 10; i++) {
      await aiService.recordUsage(accountId, userId, 'test_feature', 100, 50, 'success');
    }

    const exhausted = await aiService.getStatus(accountId);
    expect(exhausted.quota.dailyRuns.remaining).toBe(0);

    const blockedDaily = await aiService.preflightCheck(accountId, userId, { resourceIds: [note1.id] });
    expect(blockedDaily.allowed).toBe(false);
    expect(blockedDaily.errorCode).toBe('DAILY_RUNS_EXCEEDED');
  });
});
