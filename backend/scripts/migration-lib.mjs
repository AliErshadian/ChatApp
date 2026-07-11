import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function resolveMigrationsDir() {
  if (process.env.MIGRATIONS_DIR?.trim()) {
    return path.resolve(process.env.MIGRATIONS_DIR.trim());
  }
  return path.resolve(__dirname, '../../infra/postgres/migrations');
}

export function resolveInitSqlPath() {
  if (process.env.INIT_SQL_PATH?.trim()) {
    return path.resolve(process.env.INIT_SQL_PATH.trim());
  }
  return path.resolve(__dirname, '../../infra/postgres/init.sql');
}

export function normalizeMigrationContent(content) {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function sha256(content) {
  return createHash('sha256').update(normalizeMigrationContent(content)).digest('hex');
}

export function migrationVersion(filename) {
  return filename.replace(/\.sql$/i, '');
}

export async function listMigrationFiles(dir) {
  const entries = await readdir(dir);
  return entries
    .filter((name) => /^\d+_.+\.sql$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export async function loadMigrations(dir = resolveMigrationsDir()) {
  const files = await listMigrationFiles(dir);
  const migrations = [];

  for (const file of files) {
    const sql = await readFile(path.join(dir, file), 'utf8');
    migrations.push({
      file,
      version: migrationVersion(file),
      sql,
      checksum: sha256(sql),
    });
  }

  return migrations;
}

export function extractMigrationRequirements(sql) {
  const requirements = [];

  for (const match of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi)) {
    requirements.push({ kind: 'table', name: match[1] });
  }
  for (const match of sql.matchAll(/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi)) {
    requirements.push({ kind: 'index', name: match[1] });
  }
  for (const match of sql.matchAll(
    /ALTER\s+TABLE\s+(?:ONLY\s+)?(\w+)[\s\S]*?ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi,
  )) {
    requirements.push({ kind: 'column', table: match[1], name: match[2] });
  }
  for (const match of sql.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(\w+)/gi)) {
    requirements.push({ kind: 'function', name: match[1] });
  }
  for (const match of sql.matchAll(/CREATE\s+TRIGGER\s+(\w+)/gi)) {
    requirements.push({ kind: 'trigger', name: match[1] });
  }
  for (const match of sql.matchAll(/ADD\s+VALUE\s+IF\s+NOT\s+EXISTS\s+'([^']+)'/gi)) {
    requirements.push({ kind: 'enum_value', name: match[1] });
  }

  return requirements;
}

export function initSqlHasRequirement(initSql, requirement) {
  switch (requirement.kind) {
    case 'table':
      return new RegExp(`CREATE\\s+TABLE\\s+${requirement.name}\\b`, 'i').test(initSql);
    case 'index':
    case 'function':
    case 'trigger':
      return initSql.includes(requirement.name);
    case 'column':
      return new RegExp(`\\b${requirement.name}\\b`, 'i').test(initSql);
    case 'enum_value':
      return initSql.includes(`'${requirement.name}'`);
    default:
      return true;
  }
}

export function parseInitMigrationSeed(initSql) {
  const seeded = new Map();
  const pattern = /\(\s*'(\d+_[^']+)'\s*,\s*'([a-f0-9]{64})'\s*\)/g;

  for (const match of initSql.matchAll(pattern)) {
    seeded.set(match[1], match[2]);
  }

  return seeded;
}

export function formatMigrationSeedSql(migrations) {
  const lines = migrations.map(
    (migration) => `    ('${migration.version}', '${migration.checksum}')`,
  );

  return [
    'CREATE TABLE IF NOT EXISTS schema_migrations (',
    '    version TEXT PRIMARY KEY,',
    '    checksum TEXT NOT NULL,',
    '    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    ');',
    '',
    'INSERT INTO schema_migrations (version, checksum) VALUES',
    lines.join(',\n'),
    'ON CONFLICT (version) DO NOTHING;',
  ].join('\n');
}
