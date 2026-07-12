#!/usr/bin/env node
import pg from 'pg';
import { loadBackendEnv } from './load-env.mjs';
import { loadMigrations } from './migration-lib.mjs';

loadBackendEnv();

const databaseUrl =
  process.env.MIGRATE_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const migrations = await loadMigrations();
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

let updated = 0;
for (const migration of migrations) {
  const result = await client.query(
    'UPDATE schema_migrations SET checksum = $1 WHERE version = $2',
    [migration.checksum, migration.version],
  );
  updated += result.rowCount ?? 0;
}

await client.end();
console.log(`Updated ${updated} migration checksum(s)`);
