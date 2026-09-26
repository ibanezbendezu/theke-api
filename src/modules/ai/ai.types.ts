export const CURRENT_AI_CONSENT_VERSION = '2026-09-25.1';

export const isAiProviderAvailable = () => process.env.AI_PROVIDER_ENABLED === 'true';

export const BASELINE_AI_POLICY = {
  provider: 'openai',
  model: 'gpt-5.6-terra',
  store: false,
  reasoningEffort: 'medium' as const,
  retentionDays: 30,
  trainModels: false,
  description: 'Usa OpenAI Responses API con modelo gpt-5.6-terra, store:false, reasoning_effort:medium. Los datos privados no se almacenan permanentemente ni se usan para entrenamiento. Los registros de detección de abuso pueden ser retenidos por el proveedor por un máximo de 30 días.',
};

export interface AiConsentStatus {
  required: boolean;
  currentVersion: string;
  acceptedVersion: string | null;
  consentedAt: string | null;
  isConsented: boolean;
  provider: string;
  model: string;
  policy: typeof BASELINE_AI_POLICY;
}

export interface AiQuotaStatus {
  dailyRuns: {
    used: number;
    limit: number;
    remaining: number;
  };
  monthlyBudget: {
    usedUsd: number;
    limitUsd: number;
    remainingUsd: number;
  };
  maxInputTokens: number;
  maxOutputTokens: number;
}

export interface AiStatusResponse {
  enabled: boolean;
  providerAvailability: { available: boolean; reason: 'PROVIDER_PENDING' | null };
  consent: AiConsentStatus;
  quota: AiQuotaStatus;
}

export interface AiConsentInput {
  consentVersion: string;
  enabled?: boolean;
}

export interface AiSettingsInput {
  enabled: boolean;
}

export interface PreflightResourceAssessment {
  id: string;
  title: string;
  type: 'note' | 'file' | 'link';
  estimatedTokens: number;
  valid: boolean;
  issues: string[];
}

export interface AiPreflightInput {
  resourceIds: string[];
  expectedOutputTokens?: number;
}

export interface AiPreflightResult {
  allowed: boolean;
  reason?: string;
  errorCode?: 'AI_DISABLED' | 'CONSENT_REQUIRED' | 'PROVIDER_PENDING' | 'DAILY_RUNS_EXCEEDED' | 'MONTHLY_BUDGET_EXCEEDED' | 'INPUT_TOKEN_LIMIT_EXCEEDED' | 'NO_RESOURCES' | 'INVALID_RESOURCE';
  resources: PreflightResourceAssessment[];
  totalEstimatedInputTokens: number;
  maxInputTokens: number;
  remainingDailyRuns: number;
  remainingMonthlyBudgetUsd: number;
}

export interface RelationSuggestionInput {
  relationId: string;
}

export interface RelationSuggestion {
  direction: 'directed' | 'undirected';
  typeKey: 'supports' | 'contradicts' | 'depends_on' | 'related_to';
  label: string;
  explanation: string;
  uncertainty: string;
  evidence: { resourceId: string; excerpt: string }[];
  provider: string;
  model: string;
  createdAt: string;
  sourceResourceId: string;
  targetResourceId: string;
}
