#!/usr/bin/env node
/**
 * Validates process.env using the same rules as Nest bootstrap.
 * Usage: NODE_ENV=production node scripts/validate-env.mjs
 */
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadBackendEnv } from './load-env.mjs';

loadBackendEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(__dirname, '..');

const distEnv = resolve(backendRoot, 'dist/config/env.js');

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
