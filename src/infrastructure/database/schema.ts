import { bigint, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
export const users = pgTable('users', { id: uuid('id').defaultRandom().primaryKey(), clerkUserId: text('clerk_user_id').notNull().unique(), email: text('email'), displayName: text('display_name'), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull() });
export const accounts = pgTable('accounts', { id: uuid('id').defaultRandom().primaryKey(), personalOwnerUserId: uuid('personal_owner_user_id').notNull().references(() => users.id).unique(), name: text('name').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull() });
export const memberships = pgTable('memberships', { id: uuid('id').defaultRandom().primaryKey(), accountId: uuid('account_id').notNull().references(() => accounts.id), userId: uuid('user_id').notNull().references(() => users.id), role: text('role').$type<'owner' | 'member'>().notNull(), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull() }, (table) => [uniqueIndex('memberships_account_user_uq').on(table.accountId, table.userId)]);
export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  name: text('name').notNull(),
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
});
export const diagramRevisions = pgTable('diagram_revisions', {
  id: uuid('id').defaultRandom().primaryKey(),
  diagramId: uuid('diagram_id').notNull().references(() => diagrams.id),
  revision: integer('revision').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  document: jsonb('document').$type<typeof diagrams.$inferSelect.document>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [uniqueIndex('diagram_revisions_diagram_revision_uq').on(table.diagramId, table.revision), uniqueIndex('diagram_revisions_diagram_key_uq').on(table.diagramId, table.idempotencyKey)]);
export const resources = pgTable('resources', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  authorUserId: uuid('author_user_id').notNull().references(() => users.id),
  type: text('type').$type<'note' | 'file' | 'link'>().notNull(),
  title: text('title').notNull(),
  description: text('description'),
  creationMethod: text('creation_method').$type<'manual'>().notNull(),
  currentVersionId: uuid('current_version_id'),
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
export const projectResources = pgTable('project_resources', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  resourceId: uuid('resource_id').notNull().references(() => resources.id),
  folderId: uuid('folder_id').references(() => folders.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex('project_resources_project_resource_uq').on(table.projectId, table.resourceId)]);
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
  entityType: text('entity_type').$type<'resource' | 'project' | 'folder' | 'diagram'>().notNull(),
  entityId: uuid('entity_id').notNull(),
  action: text('action').$type<'archive' | 'delete'>().notNull(),
  result: jsonb('result').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex('operation_receipts_account_key_uq').on(table.accountId, table.idempotencyKey)]);
