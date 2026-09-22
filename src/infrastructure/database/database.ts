import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

@Injectable()
export class Database implements OnModuleDestroy {
  readonly pool = new Pool({ connectionString: process.env.DATABASE_URL });
  readonly db = drizzle(this.pool, { schema });
  async onModuleDestroy() { await this.pool.end(); }
}
