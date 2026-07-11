#!/usr/bin/env node
/**
 * Fails if secret env files are tracked in git or present in the index.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function listTrackedFiles() {
  try {
    return execSync('git ls-files -z', {
      cwd: repoRoot,
      encoding: 'utf8',
    })
      .split('\0')
      .filter(Boolean);
  } catch {
    return [];
  }
}

function isBlockedEnvPath(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const base = normalized.split('/').pop() ?? normalized;

  if (base === '.env' || base === '.env.local' || base === '.env.production') {
    return true;
  }

  if (base.startsWith('.env.') && !base.endsWith('.example')) {
    return true;
  }

  return false;
}

const tracked = listTrackedFiles();
const blockedTracked = tracked.filter(isBlockedEnvPath);

const stagedUntracked = [];
for (const candidate of [
  '.env',
  'backend/.env',
  'desktop/.env',
  'admin/.env',
]) {
  const fullPath = resolve(repoRoot, candidate);
  if (!existsSync(fullPath)) continue;

  try {
    const trackedPath = execSync(`git ls-files --error-unmatch ${candidate}`, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (trackedPath) stagedUntracked.push(candidate);
  } catch {
    // not tracked
  }
}

const errors = [...new Set([...blockedTracked, ...stagedUntracked])];

if (errors.length > 0) {
  console.error('Secret env files must not be committed:\n');
  for (const file of errors) {
    console.error(`- ${file}`);
  }
  console.error('\nKeep secrets in local .env files only (.gitignore). Commit .env.example instead.');
  process.exit(1);
}

console.log('Secrets OK: no .env files are tracked in git');
