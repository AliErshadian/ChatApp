#!/usr/bin/env node
/**
 * Validates process.env using the same rules as Nest bootstrap.
 * Usage: NODE_ENV=production node scripts/validate-env.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(__dirname, '..');
const envPath = resolve(backendRoot, '.env');

if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const distEnv = resolve(backendRoot, 'dist/config/env.js');
const srcEnv = resolve(backendRoot, 'src/config/env.ts');

let validateEnv;
if (existsSync(distEnv)) {
  ({ validateEnv } = await import(pathToFileURL(distEnv).href));
} else {
  console.error('Build output not found. Run: npm run build');
  console.error('Expected:', distEnv);
  process.exit(1);
}

try {
  validateEnv(process.env);
  console.log(`Environment OK (${process.env.NODE_ENV ?? 'development'})`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
