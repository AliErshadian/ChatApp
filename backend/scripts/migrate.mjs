#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { loadBackendEnv } from './load-env.mjs';
import {
  listMigrationFiles,
  resolveMigrationsDir,
  sha256,
} from './migration-lib.mjs';

loadBackendEnv();

const ADVISORY_LOCK_KEY = 748204029;

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function loadAppliedMigrations(client) {
  const result = await client.query(
    'SELECT version, checksum FROM schema_migrations ORDER BY version',
  );
  return new Map(result.rows.map((row) => [row.version, row.checksum]));
}

const DUPLICATE_SCHEMA_ERROR_CODES = new Set([
  '42P07', // duplicate_table
  '42710', // duplicate_object
  '42701', // duplicate_column
  '42P06', // duplicate_schema
  '42723', // duplicate_function
]);

function isDuplicateSchemaError(error) {
  const message = String(error?.message ?? '').toLowerCase();
  return (
    (error?.code && DUPLICATE_SCHEMA_ERROR_CODES.has(error.code)) ||
    message.includes('already exists')
  );
}

function isPrivilegeOnExistingObjectError(error) {
  const message = String(error?.message ?? '').toLowerCase();
  return (
    error?.code === '42501' ||
    message.includes('must be owner') ||
    message.includes('permission denied')
  );
}

async function tableExists(client, name) {
  const result = await client.query('SELECT to_regclass($1) IS NOT NULL AS exists', [
    `public.${name}`,
  ]);
  return Boolean(result.rows[0]?.exists);
}

async function indexExists(client, name) {
  const result = await client.query(
    `SELECT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'i'
        AND c.relname = $1
        AND n.nspname = 'public'
    ) AS exists`,
    [name],
  );
  return Boolean(result.rows[0]?.exists);
}

async function columnExists(client, table, column) {
  const result = await client.query(
    `SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2
    ) AS exists`,
    [table, column],
  );
  return Boolean(result.rows[0]?.exists);
}

async function migrationStateMatches(client, sql) {
  const requirements = [];

  for (const match of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi)) {
    requirements.push({ type: 'table', name: match[1] });
  }
  for (const match of sql.matchAll(/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi)) {
    requirements.push({ type: 'index', name: match[1] });
  }
  for (const match of sql.matchAll(
    /ALTER\s+TABLE\s+(?:ONLY\s+)?(\w+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi,
  )) {
    requirements.push({ type: 'column', table: match[1], name: match[2] });
  }

  if (requirements.length === 0) return false;

  for (const req of requirements) {
    if (req.type === 'table' && !(await tableExists(client, req.name))) return false;
    if (req.type === 'index' && !(await indexExists(client, req.name))) return false;
    if (req.type === 'column' && !(await columnExists(client, req.table, req.name))) {
      return false;
    }
  }

  return true;
}

async function shouldTreatAsAlreadyApplied(client, error, sql) {
  if (isDuplicateSchemaError(error)) return true;
  if (isPrivilegeOnExistingObjectError(error)) {
    return migrationStateMatches(client, sql);
  }
  return false;
}

async function recordMigration(client, version, checksum) {
  await client.query(
    `INSERT INTO schema_migrations (version, checksum)
     VALUES ($1, $2)
     ON CONFLICT (version) DO NOTHING`,
    [version, checksum],
  );
}

async function applyMigration(client, version, sql, checksum) {
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)`,
      [version, checksum],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const databaseUrl =
    process.env.MIGRATE_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error(
      'DATABASE_URL is required (set it in the environment or backend/.env)',
    );
    process.exit(1);
  }

  const migrationsDir = resolveMigrationsDir();
  const files = await listMigrationFiles(migrationsDir);
  if (files.length === 0) {
    console.log(`No migration files found in ${migrationsDir}`);
    return;
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  const lock = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [
    ADVISORY_LOCK_KEY,
  ]);
  if (!lock.rows[0]?.acquired) {
    console.error('Another migration runner is already active');
    await client.end();
    process.exit(1);
  }

  try {
    await ensureMigrationsTable(client);
    const applied = await loadAppliedMigrations(client);
    let appliedCount = 0;
    let skippedCount = 0;

    for (const file of files) {
      const version = file.replace(/\.sql$/i, '');
      const fullPath = path.join(migrationsDir, file);
      const sql = await readFile(fullPath, 'utf8');
      const checksum = sha256(sql);

      const existingChecksum = applied.get(version);
      if (existingChecksum) {
        if (existingChecksum !== checksum) {
          throw new Error(
            `Migration ${version} was modified after being applied (checksum mismatch)`,
          );
        }
        continue;
      }

      console.log(`Applying ${file}...`);
      try {
        await applyMigration(client, version, sql, checksum);
        appliedCount += 1;
      } catch (error) {
        if (!(await shouldTreatAsAlreadyApplied(client, error, sql))) {
          throw error;
        }

        const reason =
          error instanceof Error ? error.message : String(error);
        console.log(`Skipping ${file} (already applied): ${reason}`);
        await recordMigration(client, version, checksum);
        skippedCount += 1;
      }
    }

    if (appliedCount === 0 && skippedCount === 0) {
      console.log('Database schema is up to date');
    } else {
      const parts = [];
      if (appliedCount > 0) parts.push(`applied ${appliedCount}`);
      if (skippedCount > 0) parts.push(`skipped ${skippedCount} already present`);
      console.log(`Migrations complete (${parts.join(', ')})`);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
