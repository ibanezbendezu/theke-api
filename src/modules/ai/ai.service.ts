import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { Database } from '../../infrastructure/database/database.js';
import { accountAiSettings, aiUsageRecords, resourceAccessibility, resourceLinks, resources, resourceVersions } from '../../infrastructure/database/schema.js';
import {
  AiConsentInput,
  AiPreflightInput,
  AiPreflightResult,
  AiSettingsInput,
  AiStatusResponse,
  BASELINE_AI_POLICY,
  CURRENT_AI_CONSENT_VERSION,
  PreflightResourceAssessment,
} from './ai.types.js';

@Injectable()
export class AiService {
  constructor(@Inject(Database) private readonly database: Database) {}

  async getStatus(accountId: string): Promise<AiStatusResponse> {
    const [settings] = await this.database.db
      .select()
      .from(accountAiSettings)
      .where(eq(accountAiSettings.accountId, accountId))
      .limit(1);

    const isConsented = settings?.acceptedConsentVersion === CURRENT_AI_CONSENT_VERSION;
    const enabled = Boolean(settings?.enabled && isConsented);
    const maxInputTokens = settings?.maxInputTokens ?? 50000;
    const maxOutputTokens = settings?.maxOutputTokens ?? 4000;
    const dailyRunsLimit = settings?.dailyRunsLimit ?? 10;
    const monthlyBudgetUsd = Number(settings?.monthlyBudgetUsd ?? 5.0);

    const now = new Date();
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const [dailyUsage] = await this.database.db
      .select({ count: sql<number>`count(*)::int` })
      .from(aiUsageRecords)
      .where(
        and(
          eq(aiUsageRecords.accountId, accountId),
          gte(aiUsageRecords.createdAt, startOfDay),
          eq(aiUsageRecords.status, 'success'),
        ),
      );

    const [monthlyUsage] = await this.database.db
      .select({ cost: sql<string>`coalesce(sum(estimated_cost_usd), 0)::text` })
      .from(aiUsageRecords)
      .where(
        and(
          eq(aiUsageRecords.accountId, accountId),
          gte(aiUsageRecords.createdAt, startOfMonth),
        ),
      );

    const dailyRunsUsed = dailyUsage?.count ?? 0;
    const monthlyCostUsed = parseFloat(monthlyUsage?.cost ?? '0');

    return {
      enabled,
      consent: {
        required: !isConsented,
        currentVersion: CURRENT_AI_CONSENT_VERSION,
        acceptedVersion: settings?.acceptedConsentVersion ?? null,
        consentedAt: settings?.consentedAt ? settings.consentedAt.toISOString() : null,
        isConsented,
        provider: settings?.provider ?? BASELINE_AI_POLICY.provider,
        model: settings?.model ?? BASELINE_AI_POLICY.model,
        policy: BASELINE_AI_POLICY,
      },
      quota: {
        dailyRuns: {
          used: dailyRunsUsed,
          limit: dailyRunsLimit,
          remaining: Math.max(0, dailyRunsLimit - dailyRunsUsed),
        },
        monthlyBudget: {
          usedUsd: monthlyCostUsed,
          limitUsd: monthlyBudgetUsd,
          remainingUsd: Math.max(0, Number((monthlyBudgetUsd - monthlyCostUsed).toFixed(2))),
        },
        maxInputTokens,
        maxOutputTokens,
      },
    };
  }

  async updateConsent(accountId: string, userId: string, input: AiConsentInput): Promise<AiStatusResponse> {
    if (input.consentVersion !== CURRENT_AI_CONSENT_VERSION) {
      throw new BadRequestException(`Versión de consentimiento no válida. La versión vigente es ${CURRENT_AI_CONSENT_VERSION}`);
    }

    const enable = input.enabled ?? true;

    await this.database.db
      .insert(accountAiSettings)
      .values({
        accountId,
        enabled: enable,
        acceptedConsentVersion: input.consentVersion,
        consentedAt: new Date(),
        consentedByUserId: userId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: accountAiSettings.accountId,
        set: {
          enabled: enable,
          acceptedConsentVersion: input.consentVersion,
          consentedAt: new Date(),
          consentedByUserId: userId,
          updatedAt: new Date(),
        },
      });

    return this.getStatus(accountId);
  }

  async revokeConsent(accountId: string): Promise<AiStatusResponse> {
    await this.database.db
      .insert(accountAiSettings)
      .values({
        accountId,
        enabled: false,
        acceptedConsentVersion: null,
        consentedAt: null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: accountAiSettings.accountId,
        set: {
          enabled: false,
          acceptedConsentVersion: null,
          consentedAt: null,
          updatedAt: new Date(),
        },
      });

    return this.getStatus(accountId);
  }

  async updateSettings(accountId: string, input: AiSettingsInput): Promise<AiStatusResponse> {
    if (input.enabled) {
      const status = await this.getStatus(accountId);
      if (!status.consent.isConsented) {
        throw new BadRequestException('No se puede activar la asistencia de IA sin otorgar consentimiento explícito para las condiciones vigentes.');
      }
    }

    await this.database.db
      .insert(accountAiSettings)
      .values({
        accountId,
        enabled: input.enabled,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: accountAiSettings.accountId,
        set: {
          enabled: input.enabled,
          updatedAt: new Date(),
        },
      });

    return this.getStatus(accountId);
  }

  async preflightCheck(accountId: string, userId: string, input: AiPreflightInput): Promise<AiPreflightResult> {
    const status = await this.getStatus(accountId);

    if (!status.enabled) {
      return {
        allowed: false,
        errorCode: 'AI_DISABLED',
        reason: 'La asistencia de IA está desactivada.',
        resources: [],
        totalEstimatedInputTokens: 0,
        maxInputTokens: status.quota.maxInputTokens,
        remainingDailyRuns: status.quota.dailyRuns.remaining,
        remainingMonthlyBudgetUsd: status.quota.monthlyBudget.remainingUsd,
      };
    }

    if (!status.consent.isConsented) {
      return {
        allowed: false,
        errorCode: 'CONSENT_REQUIRED',
        reason: 'Se requiere consentimiento informado para las condiciones vigentes de IA antes de realizar el análisis.',
        resources: [],
        totalEstimatedInputTokens: 0,
        maxInputTokens: status.quota.maxInputTokens,
        remainingDailyRuns: status.quota.dailyRuns.remaining,
        remainingMonthlyBudgetUsd: status.quota.monthlyBudget.remainingUsd,
      };
    }

    if (status.quota.dailyRuns.remaining <= 0) {
      return {
        allowed: false,
        errorCode: 'DAILY_RUNS_EXCEEDED',
        reason: `Se ha alcanzado el límite diario de ejecuciones de IA (${status.quota.dailyRuns.limit}/día). La operativa manual sigue 100% disponible.`,
        resources: [],
        totalEstimatedInputTokens: 0,
        maxInputTokens: status.quota.maxInputTokens,
        remainingDailyRuns: 0,
        remainingMonthlyBudgetUsd: status.quota.monthlyBudget.remainingUsd,
      };
    }

    if (status.quota.monthlyBudget.remainingUsd <= 0) {
      return {
        allowed: false,
        errorCode: 'MONTHLY_BUDGET_EXCEEDED',
        reason: `Se ha alcanzado el límite de presupuesto mensual de IA ($${status.quota.monthlyBudget.limitUsd.toFixed(2)} USD). La operativa manual sigue 100% disponible.`,
        resources: [],
        totalEstimatedInputTokens: 0,
        maxInputTokens: status.quota.maxInputTokens,
        remainingDailyRuns: status.quota.dailyRuns.remaining,
        remainingMonthlyBudgetUsd: 0,
      };
    }

    if (!input.resourceIds || input.resourceIds.length === 0) {
      return {
        allowed: false,
        errorCode: 'NO_RESOURCES',
        reason: 'No se han especificado recursos en el alcance.',
        resources: [],
        totalEstimatedInputTokens: 0,
        maxInputTokens: status.quota.maxInputTokens,
        remainingDailyRuns: status.quota.dailyRuns.remaining,
        remainingMonthlyBudgetUsd: status.quota.monthlyBudget.remainingUsd,
      };
    }

    // Fetch resources
    const matchedResources = await this.database.db
      .select({
        id: resources.id,
        title: resources.title,
        type: resources.type,
        currentVersionId: resources.currentVersionId,
        content: resourceVersions.content,
        byteSize: resourceVersions.byteSize,
        linkUrl: resourceLinks.url,
        linkMetadataStatus: resourceLinks.metadataStatus,
        accessibilityText: resourceAccessibility.text,
      })
      .from(resources)
      .leftJoin(resourceVersions, eq(resources.currentVersionId, resourceVersions.id))
      .leftJoin(resourceLinks, eq(resources.id, resourceLinks.resourceId))
      .leftJoin(resourceAccessibility, eq(resources.id, resourceAccessibility.resourceId))
      .where(
        and(
          eq(resources.accountId, accountId),
          inArray(resources.id, input.resourceIds),
          isNull(resources.archivedAt),
          isNull(resources.deletedAt),
        ),
      );

    const resourceMap = new Map(matchedResources.map((r) => [r.id, r]));
    const assessments: PreflightResourceAssessment[] = [];
    let totalEstimatedInputTokens = 0;
    let hasIssues = false;

    for (const resId of input.resourceIds) {
      const res = resourceMap.get(resId);
      if (!res) {
        assessments.push({
          id: resId,
          title: 'Recurso desconocido',
          type: 'note',
          estimatedTokens: 0,
          valid: false,
          issues: ['El recurso no existe, está archivado o no pertenece a esta cuenta.'],
        });
        hasIssues = true;
        continue;
      }

      const issues: string[] = [];
      let estimatedTokens = 50; // base prompt overhead per resource

      if (res.type === 'note') {
        const textContent = res.content ?? '';
        estimatedTokens += Math.ceil(textContent.length / 3.5);
      } else if (res.type === 'link') {
        const textContent = (res.accessibilityText ?? '') + ' ' + (res.linkUrl ?? '');
        estimatedTokens += Math.ceil(textContent.length / 3.5);
        if (res.linkMetadataStatus === 'failed') {
          issues.push('La extracción de contenido del enlace web falló previamente.');
        }
      } else if (res.type === 'file') {
        const textContent = res.accessibilityText ?? '';
        if (textContent.length > 0) {
          estimatedTokens += Math.ceil(textContent.length / 3.5);
        } else {
          issues.push('El archivo no dispone de capa de texto extraída o accesible para análisis.');
        }
      }

      if (estimatedTokens > status.quota.maxInputTokens) {
        issues.push(`El recurso excede individualmente el límite de ${status.quota.maxInputTokens} tokens.`);
      }

      const valid = issues.length === 0;
      if (!valid) {
        hasIssues = true;
      }

      assessments.push({
        id: res.id,
        title: res.title,
        type: res.type,
        estimatedTokens,
        valid,
        issues,
      });

      totalEstimatedInputTokens += estimatedTokens;
    }

    if (totalEstimatedInputTokens > status.quota.maxInputTokens) {
      return {
        allowed: false,
        errorCode: 'INPUT_TOKEN_LIMIT_EXCEEDED',
        reason: `El alcance total (${totalEstimatedInputTokens.toLocaleString()} tokens estimados) supera el límite máximo por solicitud (${status.quota.maxInputTokens.toLocaleString()} tokens). Acota la selección de recursos antes de continuar.`,
        resources: assessments,
        totalEstimatedInputTokens,
        maxInputTokens: status.quota.maxInputTokens,
        remainingDailyRuns: status.quota.dailyRuns.remaining,
        remainingMonthlyBudgetUsd: status.quota.monthlyBudget.remainingUsd,
      };
    }

    if (hasIssues) {
      return {
        allowed: false,
        errorCode: 'INVALID_RESOURCE',
        reason: 'Algunos recursos en el alcance presentan limitaciones de formato, tamaño o accesibilidad. Corrige o deselecciona los recursos afectados.',
        resources: assessments,
        totalEstimatedInputTokens,
        maxInputTokens: status.quota.maxInputTokens,
        remainingDailyRuns: status.quota.dailyRuns.remaining,
        remainingMonthlyBudgetUsd: status.quota.monthlyBudget.remainingUsd,
      };
    }

    return {
      allowed: true,
      resources: assessments,
      totalEstimatedInputTokens,
      maxInputTokens: status.quota.maxInputTokens,
      remainingDailyRuns: status.quota.dailyRuns.remaining,
      remainingMonthlyBudgetUsd: status.quota.monthlyBudget.remainingUsd,
    };
  }

  async recordUsage(
    accountId: string,
    userId: string,
    feature: string,
    inputTokens: number,
    outputTokens: number,
    status: 'success' | 'failed' | 'blocked_quota' | 'rejected',
  ) {
    const estimatedCostUsd = (inputTokens * 0.000003 + outputTokens * 0.000015).toFixed(4);

    await this.database.db.insert(aiUsageRecords).values({
      accountId,
      userId,
      feature,
      consentVersion: CURRENT_AI_CONSENT_VERSION,
      provider: BASELINE_AI_POLICY.provider,
      model: BASELINE_AI_POLICY.model,
      inputTokens,
      outputTokens,
      estimatedCostUsd,
      status,
    });
  }
}
