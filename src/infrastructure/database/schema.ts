import { isNotNull, isNull } from 'drizzle-orm';
import { bigint, boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
export const users = pgTable('users', { id: uuid('id').defaultRandom().primaryKey(), clerkUserId: text('clerk_user_id').notNull().unique(), email: text('email'), displayName: text('display_name'), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull() });
export const accounts = pgTable('accounts', { id: uuid('id').defaultRandom().primaryKey(), personalOwnerUserId: uuid('personal_owner_user_id').notNull().references(() => users.id).unique(), name: text('name').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull() });
export const memberships = pgTable('memberships', { id: uuid('id').defaultRandom().primaryKey(), accountId: uuid('account_id').notNull().references(() => accounts.id), userId: uuid('user_id').notNull().references(() => users.id), role: text('role').$type<'owner' | 'member'>().notNull(), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull() }, (table) => [uniqueIndex('memberships_account_user_uq').on(table.accountId, table.userId)]);
export const projectFolders = pgTable('project_folders', { id: uuid('id').defaultRandom().primaryKey(), accountId: uuid('account_id').notNull().references(() => accounts.id), name: text('name').notNull(), parentFolderId: uuid('parent_folder_id'), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull() }, table => [uniqueIndex('project_folders_account_root_name_uq').on(table.accountId, table.name).where(isNull(table.parentFolderId)), uniqueIndex('project_folders_account_parent_name_uq').on(table.accountId, table.parentFolderId, table.name).where(isNotNull(table.parentFolderId)), index('project_folders_account_parent_idx').on(table.accountId, table.parentFolderId)]);
export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  name: text('name').notNull(),
  collectionFolderId: uuid('collection_folder_id').references(() => projectFolders.id),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  purgeAfter: timestamp('purge_after', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
export const diagrams = pgTable('diagrams', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  name: text('name').notNull(),
  document: jsonb('document').$type<{ schemaVersion: number; nodes: unknown[]; edges: unknown[]; viewport: { x: number; y: number; zoom: number }; background?: { variant: 'plain' | 'dots' | 'grid'; tone: 'default' | 'surface' } }>().notNull(),
  revision: integer('revision').default(0).notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  purgeAfter: timestamp('purge_after', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [uniqueIndex('diagrams_project_live_uq').on(table.projectId).where(isNull(table.deletedAt))]);
export const diagramRevisions = pgTable('diagram_revisions', {
  id: uuid('id').defaultRandom().primaryKey(),
  diagramId: uuid('diagram_id').notNull().references(() => diagrams.id),
  revision: integer('revision').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  document: jsonb('document').$type<typeof diagrams.$inferSelect.document>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [uniqueIndex('diagram_revisions_diagram_revision_uq').on(table.diagramId, table.revision), uniqueIndex('diagram_revisions_diagram_key_uq').on(table.diagramId, table.idempotencyKey)]);
export const diagramShares = pgTable('diagram_shares', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  diagramId: uuid('diagram_id').notNull().references(() => diagrams.id),
  tokenHash: text('token_hash').notNull().unique(),
  idempotencyKey: text('idempotency_key').notNull(),
  fingerprint: text('fingerprint').notNull(),
    projection: jsonb('projection').$type<{ diagramName: string; revision: number; resources: unknown[]; relations: unknown[];
      layout?: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[]; background?: { variant: string; tone: string } } }>().notNull(),
  mediaManifest: jsonb('media_manifest').$type<Record<string, { versionId: string; storageKey: string; mediaType: string; filename: string }>>().notNull().default({}),
  commentsEnabled: boolean('comments_enabled').notNull().default(true),
  relationLabelsFrozenAt: timestamp('relation_labels_frozen_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [uniqueIndex('diagram_shares_account_key_uq').on(table.accountId, table.idempotencyKey), uniqueIndex('diagram_shares_active_diagram_uq').on(table.diagramId).where(isNull(table.revokedAt))]);
export const diagramShareEvents = pgTable('diagram_share_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  diagramId: uuid('diagram_id').notNull().references(() => diagrams.id),
  shareId: uuid('share_id').notNull().references(() => diagramShares.id),
  actorUserId: uuid('actor_user_id').notNull().references(() => users.id),
    action: text('action').$type<'published' | 'retried' | 'refreshed' | 'comments_changed' | 'revoked'>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
export type PublicCommentAnchor =
  | { type: 'diagram'; x?: number; y?: number }
  | { type: 'resource'; resourceId: string; x?: number; y?: number; label: string }
  | { type: 'relation'; relationId: string; x?: number; y?: number; label: string };
export const publicShareComments = pgTable('public_share_comments', {
  id: uuid('id').defaultRandom().primaryKey(),
  shareId: uuid('share_id').notNull().references(() => diagramShares.id),
    ownerHash: text('owner_hash').notNull(),
    authorUserId: uuid('author_user_id').references(() => users.id),
  ipHash: text('ip_hash').notNull(),
  displayName: text('display_name').notNull(),
  content: text('content').notNull(),
  revision: integer('revision').notNull().default(1),
  anchor: jsonb('anchor').$type<PublicCommentAnchor>().notNull().default({ type: 'diagram' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  editedAt: timestamp('edited_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  orphanedAt: timestamp('orphaned_at', { withTimezone: true }),
  purgeAfter: timestamp('purge_after', { withTimezone: true }),
}, table => [index('public_share_comments_share_created_idx').on(table.shareId, table.createdAt), index('public_share_comments_owner_idx').on(table.shareId, table.ownerHash)]);
export const commentModerationEvents = pgTable('comment_moderation_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  actorUserId: uuid('actor_user_id').notNull().references(() => users.id),
  commentId: uuid('comment_id').notNull(),
  action: text('action').$type<'resolved' | 'reopened' | 'deleted'>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [index('comment_moderation_events_account_created_idx').on(table.accountId, table.createdAt)]);
export const commentNotifications = pgTable('comment_notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  diagramId: uuid('diagram_id').notNull().references(() => diagrams.id),
  commentId: uuid('comment_id').notNull().references(() => publicShareComments.id),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [uniqueIndex('comment_notifications_comment_uq').on(table.commentId), index('comment_notifications_account_created_idx').on(table.accountId, table.createdAt)]);
export const publicShareCommentMutations = pgTable('public_share_comment_mutations', {
  id: uuid('id').defaultRandom().primaryKey(),
  shareId: uuid('share_id').notNull().references(() => diagramShares.id),
  commentId: uuid('comment_id').notNull().references(() => publicShareComments.id),
  ownerHash: text('owner_hash').notNull(),
  ipHash: text('ip_hash').notNull(),
  action: text('action').$type<'created' | 'edited'>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [index('public_share_comment_mutations_share_time_idx').on(table.shareId, table.createdAt), index('public_share_comment_mutations_owner_time_idx').on(table.ownerHash, table.createdAt), index('public_share_comment_mutations_ip_time_idx').on(table.ipHash, table.createdAt)]);
export const resources = pgTable('resources', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  authorUserId: uuid('author_user_id').notNull().references(() => users.id),
  type: text('type').$type<'note' | 'file' | 'link'>().notNull(),
  title: text('title').notNull(),
  description: text('description'),
  aliases: jsonb('aliases').$type<string[]>().default([]).notNull(),
  tags: jsonb('tags').$type<string[]>().default([]).notNull(),
  properties: jsonb('properties').$type<Record<string, string | number | boolean | string[]>>().default({}).notNull(),
  creationMethod: text('creation_method').$type<'manual'>().notNull(),
  currentVersionId: uuid('current_version_id'),
  libraryFolderId: uuid('library_folder_id').references(() => libraryFolders.id),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  purgeAfter: timestamp('purge_after', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
export const resourceLinks = pgTable('resource_links', {
  resourceId: uuid('resource_id').primaryKey().references(() => resources.id),
  url: text('url').notNull(),
  previewImageUrl: text('preview_image_url'),
  metadataStatus: text('metadata_status').$type<'pending' | 'ready' | 'failed'>().notNull(),
  metadataFailure: text('metadata_failure'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
export const resourceVersions = pgTable('resource_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  resourceId: uuid('resource_id').notNull().references(() => resources.id),
  authorUserId: uuid('author_user_id').notNull().references(() => users.id),
  ordinal: integer('ordinal').notNull(),
  content: text('content').notNull(),
  contentHash: text('content_hash').notNull(),
  storageKey: text('storage_key'),
  mediaType: text('media_type'),
  byteSize: bigint('byte_size', { mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('resource_versions_resource_ordinal_uq').on(table.resourceId, table.ordinal),
]);
export const folders = pgTable('folders', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  name: text('name').notNull(),
  parentFolderId: uuid('parent_folder_id'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
export const libraryFolders = pgTable('library_folders', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  name: text('name').notNull(),
  parentFolderId: uuid('parent_folder_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [uniqueIndex('library_folders_account_root_name_uq').on(table.accountId, table.name).where(isNull(table.parentFolderId)), uniqueIndex('library_folders_account_parent_name_uq').on(table.accountId, table.parentFolderId, table.name).where(isNotNull(table.parentFolderId)), index('library_folders_account_parent_idx').on(table.accountId, table.parentFolderId)]);
export const resourcePropertyDefinitions = pgTable('resource_property_definitions', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  key: text('key').notNull(),
  type: text('type').$type<'text' | 'list' | 'number' | 'checkbox' | 'date' | 'datetime'>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [uniqueIndex('resource_property_definitions_account_key_uq').on(table.accountId, table.key)]);
export const resourceMentions = pgTable('resource_mentions', {
  id: uuid('id').defaultRandom().primaryKey(),
  sourceResourceId: uuid('source_resource_id').notNull().references(() => resources.id),
  sourceVersionId: uuid('source_version_id').notNull().references(() => resourceVersions.id),
  targetResourceId: uuid('target_resource_id').references(() => resources.id),
  rawTarget: text('raw_target').notNull(),
  displayText: text('display_text'),
  anchor: text('anchor'),
  startOffset: integer('start_offset').notNull(),
  endOffset: integer('end_offset').notNull(),
  resolution: text('resolution').$type<'linked' | 'unresolved' | 'ambiguous'>().notNull(),
}, table => [uniqueIndex('resource_mentions_source_version_start_uq').on(table.sourceVersionId, table.startOffset)]);
export const projectResources = pgTable('project_resources', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  resourceId: uuid('resource_id').notNull().references(() => resources.id),
  folderId: uuid('folder_id').references(() => folders.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex('project_resources_project_resource_uq').on(table.projectId, table.resourceId), index('project_resources_resource_idx').on(table.resourceId)]);
export const relationTypes = pgTable('relation_types', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  originProjectId: uuid('origin_project_id').notNull().references(() => projects.id),
  label: text('label').notNull(),
  labelKey: text('label_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [uniqueIndex('relation_types_project_label_uq').on(table.originProjectId, table.labelKey)]);
export const relations = pgTable('relations', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  diagramId: uuid('diagram_id').references(() => diagrams.id),
  sourceResourceId: uuid('source_resource_id').notNull().references(() => resources.id),
  targetResourceId: uuid('target_resource_id').notNull().references(() => resources.id),
  direction: text('direction').$type<'directed' | 'undirected'>().notNull(),
  typeKey: text('type_key').notNull(),
  label: text('label'),
  explanation: text('explanation'),
  provenance: text('provenance'),
  evidenceStatus: text('evidence_status').$type<'none' | 'needs_evidence' | 'confirmed'>().default('none').notNull(),
  revision: integer('revision').default(0).notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  purgeAfter: timestamp('purge_after', { withTimezone: true }),
  createdByUserId: uuid('created_by_user_id').references(() => users.id),
  updatedByUserId: uuid('updated_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [uniqueIndex('relations_equivalent_uq').on(table.diagramId, table.sourceResourceId, table.targetResourceId, table.direction, table.typeKey).where(isNull(table.deletedAt))]);
export const relationEvidence = pgTable('relation_evidence', {
  id: uuid('id').defaultRandom().primaryKey(),
  relationId: uuid('relation_id').notNull().references(() => relations.id),
  resourceId: uuid('resource_id').notNull().references(() => resources.id),
  resourceVersionId: uuid('resource_version_id').references(() => resourceVersions.id),
  startOffset: integer('start_offset'),
  endOffset: integer('end_offset'),
  pageNumber: integer('page_number'),
  excerpt: text('excerpt'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
export const uploads = pgTable('uploads', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  resourceId: uuid('resource_id').notNull().references(() => resources.id),
  idempotencyKey: text('idempotency_key').notNull(),
  status: text('status').$type<'initiated' | 'finalizing' | 'uploaded' | 'scanning' | 'ready' | 'rejected' | 'failed' | 'cancelled'>().notNull(),
  originalName: text('original_name').notNull(),
  declaredMediaType: text('declared_media_type').notNull(),
  declaredSize: bigint('declared_size', { mode: 'number' }).notNull(),
  quarantineKey: text('quarantine_key').notNull(),
  snapshotKey: text('snapshot_key'),
  cleanKey: text('clean_key'),
  etag: text('etag'),
  sha256: text('sha256'),
  detectedMediaType: text('detected_media_type'),
  failureReason: text('failure_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex('uploads_account_idempotency_uq').on(table.accountId, table.idempotencyKey)]);
export const resourceAccessibility = pgTable('resource_accessibility', {
  resourceId: uuid('resource_id').primaryKey().references(() => resources.id),
  text: text('text').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
export const operationReceipts = pgTable('operation_receipts', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  idempotencyKey: text('idempotency_key').notNull(),
  entityType: text('entity_type').$type<'resource' | 'project' | 'folder' | 'diagram' | 'relation'>().notNull(),
  entityId: uuid('entity_id').notNull(),
  action: text('action').$type<'archive' | 'delete'>().notNull(),
  result: jsonb('result').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex('operation_receipts_account_key_uq').on(table.accountId, table.idempotencyKey)]);

export const accountAiSettings = pgTable('account_ai_settings', {
  accountId: uuid('account_id').primaryKey().references(() => accounts.id),
  enabled: boolean('enabled').default(false).notNull(),
  provider: text('provider').default('openai').notNull(),
  model: text('model').default('gpt-5.6-terra').notNull(),
  acceptedConsentVersion: text('accepted_consent_version'),
  consentedAt: timestamp('consented_at', { withTimezone: true }),
  consentedByUserId: uuid('consented_by_user_id').references(() => users.id),
  maxInputTokens: integer('max_input_tokens').default(50000).notNull(),
  maxOutputTokens: integer('max_output_tokens').default(4000).notNull(),
  dailyRunsLimit: integer('daily_runs_limit').default(10).notNull(),
  monthlyBudgetUsd: numeric('monthly_budget_usd', { precision: 10, scale: 2 }).default('5.00').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const aiUsageRecords = pgTable('ai_usage_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  feature: text('feature').notNull(),
  consentVersion: text('consent_version').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').default(0).notNull(),
  outputTokens: integer('output_tokens').default(0).notNull(),
  estimatedCostUsd: numeric('estimated_cost_usd', { precision: 10, scale: 4 }).default('0.0000').notNull(),
  status: text('status').$type<'success' | 'failed' | 'blocked_quota' | 'rejected'>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('ai_usage_records_account_created_idx').on(table.accountId, table.createdAt),
]);
