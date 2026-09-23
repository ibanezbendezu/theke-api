import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
export const users = pgTable('users', { id: uuid('id').defaultRandom().primaryKey(), clerkUserId: text('clerk_user_id').notNull().unique(), email: text('email'), displayName: text('display_name'), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull() });
export const accounts = pgTable('accounts', { id: uuid('id').defaultRandom().primaryKey(), personalOwnerUserId: uuid('personal_owner_user_id').notNull().references(() => users.id).unique(), name: text('name').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull() });
export const memberships = pgTable('memberships', { id: uuid('id').defaultRandom().primaryKey(), accountId: uuid('account_id').notNull().references(() => accounts.id), userId: uuid('user_id').notNull().references(() => users.id), role: text('role').$type<'owner' | 'member'>().notNull(), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull() }, (table) => [uniqueIndex('memberships_account_user_uq').on(table.accountId, table.userId)]);
export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  name: text('name').notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
export const resources = pgTable('resources', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  authorUserId: uuid('author_user_id').notNull().references(() => users.id),
  type: text('type').$type<'note'>().notNull(),
  title: text('title').notNull(),
  description: text('description'),
  creationMethod: text('creation_method').$type<'manual'>().notNull(),
  currentVersionId: uuid('current_version_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
export const resourceVersions = pgTable('resource_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  resourceId: uuid('resource_id').notNull().references(() => resources.id),
  authorUserId: uuid('author_user_id').notNull().references(() => users.id),
  ordinal: integer('ordinal').notNull(),
  content: text('content').notNull(),
  contentHash: text('content_hash').notNull(),
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
