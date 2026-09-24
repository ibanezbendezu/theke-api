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
];
try {
  for (const [table, path] of migrations) {
    const existing = await pool.query('select to_regclass($1) as relation', [`public.${table}`]);
    if (existing.rows[0].relation) continue;
    await pool.query(await readFile(new URL(path, import.meta.url), 'utf8'));
    console.log(`Migración aplicada: ${table}`);
  }
  console.log('Migraciones al día.');
} finally { await pool.end(); }
