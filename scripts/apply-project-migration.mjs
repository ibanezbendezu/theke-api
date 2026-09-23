import { readFile } from 'node:fs/promises';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const existing = await pool.query(`select to_regclass('public.projects') as projects`);
  if (existing.rows[0].projects) console.log('La migración de proyectos ya estaba aplicada.');
  else {
    const sql = await readFile(new URL('../drizzle/0002_projects.sql', import.meta.url), 'utf8');
    await pool.query(sql);
    console.log('Migración de proyectos aplicada.');
  }
} finally {
  await pool.end();
}
