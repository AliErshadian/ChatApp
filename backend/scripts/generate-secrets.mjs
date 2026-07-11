#!/usr/bin/env node
import { randomBytes } from 'node:crypto';

const access = randomBytes(32).toString('hex');
const refresh = randomBytes(32).toString('hex');

console.log('# Paste into backend/.env (never commit this file)');
console.log(`JWT_ACCESS_SECRET=${access}`);
console.log(`JWT_REFRESH_SECRET=${refresh}`);
console.log('');
console.log('# Rotation: move the old access secret here for one access-token TTL, then remove it');
console.log('# JWT_ACCESS_SECRET_PREVIOUS=<old-access-secret>');
