/* global process, URL, console */
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const migrations = [
  ['projects', '../drizzle/0002_projects.sql'],
  ['resources', '../drizzle/0003_note_resources.sql'],
  ['folders', '../drizzle/0004_project_organization.sql'],
  ['uploads', '../drizzle/0005_secure_uploads.sql'],
  ['resource_accessibility', '../drizzle/0006_resource_accessibility.sql'],
  ['resource_links', '../drizzle/0007_resource_links.sql'],
  ['resources_title_search_idx', '../drizzle/0008_resource_search.sql'],
  ['operation_receipts', '../drizzle/0009_destructive_lifecycle.sql'],
  ['diagrams', '../drizzle/0010_diagrams.sql'],
  ['diagram_revisions', '../drizzle/0011_diagram_revisions.sql'],
  ['relation_types', '../drizzle/0012_relations.sql'],
  ['relation_evidence', '../drizzle/0013_relation_details.sql'],
  ['relations.archived_at', '../drizzle/0014_relation_lifecycle.sql'],
  ['resource_mentions', '../drizzle/0015_resource_knowledge.sql'],
  ['account_ai_settings', '../drizzle/0016_ai_governance.sql'],
  ['diagram_shares', '../drizzle/0017_diagram_shares.sql'],
  ['diagram_share_events', '../drizzle/0018_diagram_share_media_audit.sql'],
  ['diagram_shares.comments_enabled', '../drizzle/0019_diagram_share_management.sql'],
  ['library_folders', '../drizzle/0020_collection_folders.sql'],
  ['project_folders', '../drizzle/0020_collection_folders.sql'],
  ['diagrams_project_live_uq', '../drizzle/0021_one_map_per_project.sql'],
  ['project_resources_resource_idx', '../drizzle/0022_map_resource_memberships.sql'],
  ['project_folders.parent_folder_id', '../drizzle/0023_nested_collection_folders.sql'],
  ['project_folders_account_root_name_uq', '../drizzle/0024_nested_folder_names.sql'],
];
try {
  for (const [table, path] of migrations) {
    const existing = table.includes('.')
      ? await pool.query('select 1 as relation from information_schema.columns where table_schema = $1 and table_name = $2 and column_name = $3', ['public', ...table.split('.')])
      : await pool.query('select to_regclass($1) as relation', [`public.${table}`]);
    if (table.includes('.') ? existing.rowCount : existing.rows[0].relation) continue;
    await pool.query(await readFile(new URL(path, import.meta.url), 'utf8'));
    console.log(`Migración aplicada: ${table}`);
  }
  console.log('Migraciones al día.');
} finally { await pool.end(); }
