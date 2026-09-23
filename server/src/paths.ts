import { fileURLToPath } from 'node:url';

// Resolved from this file, which sits one level below the workspace root both as
// source (server/src) and as build output (server/dist).
const serverRoot = new URL('../', import.meta.url);

export const MIGRATIONS_DIR = fileURLToPath(new URL('migrations/', serverRoot));
export const CLIENT_ROOT = fileURLToPath(new URL('../client/', serverRoot));
export const CLIENT_DIST = fileURLToPath(new URL('../client/dist/', serverRoot));
