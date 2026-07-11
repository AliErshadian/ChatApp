#!/usr/bin/env node
/**
 * Ensures infra/postgres/init.sql stays aligned with incremental migrations.
 * File-only check (no database). Checksums normalize CRLF to LF for cross-platform CI.
 * Run after editing init.sql or any file in infra/postgres/migrations/.
 */
import { readFile } from 'node:fs/promises';
import {
  extractMigrationRequirements,
  initSqlHasRequirement,
  loadMigrations,
  parseInitMigrationSeed,
  resolveInitSqlPath,
} from './migration-lib.mjs';

async function main() {
  const initSqlPath = resolveInitSqlPath();
  const initSql = await readFile(initSqlPath, 'utf8');
  const migrations = await loadMigrations();
  const seeded = parseInitMigrationSeed(initSql);
  const errors = [];

  for (const migration of migrations) {
    const missingRequirements = extractMigrationRequirements(migration.sql).filter(
      (requirement) => !initSqlHasRequirement(initSql, requirement),
    );

    if (missingRequirements.length > 0) {
      for (const requirement of missingRequirements) {
        errors.push(
          `${migration.file}: init.sql is missing ${requirement.kind} "${requirement.name}"${
            requirement.table ? ` on ${requirement.table}` : ''
          }`,
        );
      }
    }

    const seededChecksum = seeded.get(migration.version);
    if (!seededChecksum) {
      errors.push(
        `${migration.file}: schema_migrations seed in init.sql is missing version ${migration.version}`,
      );
    } else if (seededChecksum !== migration.checksum) {
      errors.push(
        `${migration.file}: init.sql seed checksum mismatch for ${migration.version} (update the schema_migrations INSERT in init.sql)`,
      );
    }
  }

  for (const version of seeded.keys()) {
    if (!migrations.some((migration) => migration.version === version)) {
      errors.push(`init.sql seeds unknown migration version ${version}`);
    }
  }

  if (errors.length > 0) {
    console.error('Schema drift detected between init.sql and migrations:\n');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(
    `Schema OK: init.sql matches ${migrations.length} migration file(s) and seeds schema_migrations`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
