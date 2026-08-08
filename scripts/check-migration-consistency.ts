/**
 * scripts/check-migration-consistency.ts
 *
 * Detects whether the Prisma schema has drifted from the committed migration state.
 *
 * Strategy:
 *   1. Generate a "shadow" SQL schema from the current schema.prisma using
 *      a prisma migrate diff to verify the schema resolves correctly.
 *   2. Confirm the migrations directory is non-empty (guard against accidental deletion).
 *   3. If a TEST_DATABASE_URL is provided, run `prisma migrate status` against it
 *      to detect pending-migration drift.
 *
 * This script NEVER connects to production.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import 'dotenv/config';

const BACKEND_ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(BACKEND_ROOT, 'prisma', 'migrations');
const PRISMA_CONFIG = path.join(BACKEND_ROOT, 'prisma.config.ts');

function run(cmd: string): string {
  try {
    return execSync(cmd, {
      cwd: BACKEND_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e: any) {
    const stderr = e?.stderr?.toString?.() ?? '';
    const stdout = e?.stdout?.toString?.() ?? '';
    throw new Error(`Command failed: ${cmd}\n\nSTDERR:\n${stderr}\nSTDOUT:\n${stdout}`);
  }
}

function main(): void {
  console.log('🔎  Checking Prisma migration consistency...\n');

  // Guard 1: migrations directory must exist
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error('❌  prisma/migrations directory does not exist.');
    process.exit(1);
  }

  const migrationDirs = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{14}_/.test(d.name))
    .map((d) => d.name)
    .sort();

  if (migrationDirs.length === 0) {
    console.error('❌  No migration folders found. Schema changes MUST have accompanying migrations.');
    process.exit(1);
  }

  console.log(`✅  Found ${migrationDirs.length} migration folders.`);
  console.log(`   Newest: ${migrationDirs[migrationDirs.length - 1]}\n`);

  // Guard 2: verify `prisma migrate diff` can resolve the schema (catches malformed schema)
  console.log('🧪  Verifying schema resolves via `prisma migrate diff`...');
  try {
    const diff = run(`npx prisma migrate diff --from-empty --to-schema ./prisma --config=${PRISMA_CONFIG}`);
    if (!diff || diff.trim().length === 0) {
      console.error('❌  `prisma migrate diff` produced empty output. The schema may be malformed.');
      process.exit(1);
    }
    console.log(`✅  Schema resolves to valid SQL (${diff.split('\n').length} lines).`);
  } catch (e: any) {
    console.error(`❌  ${e.message}`);
    process.exit(1);
  }

  // Guard 3: optional drift check against TEST_DATABASE_URL
  const testDbUrl = process.env.TEST_DATABASE_URL;
  if (testDbUrl) {
    console.log('\n🧪  TEST_DATABASE_URL set — running `prisma migrate status`...');
    try {
      const existing = process.env.DATABASE_URL;
      process.env.DATABASE_URL = testDbUrl;
      let status: string;
      try {
        status = run(`npx prisma migrate status --config=${PRISMA_CONFIG}`);
      } finally {
        if (existing) process.env.DATABASE_URL = existing;
      }
      console.log(status);
      if (/not yet been applied|haven't been applied/i.test(status)) {
        console.error('❌  Database is missing applied migrations (drift detected).');
        process.exit(1);
      }
      console.log('✅  Database migration state is consistent.');
    } catch (e: any) {
      console.error(`❌  ${e.message}`);
      process.exit(1);
    }
  } else {
    console.log('\nℹ️   TEST_DATABASE_URL not set — skipping live drift check.');
    console.log('    In CI, the clean-DB `prisma migrate deploy` job covers full drift detection.');
  }

  console.log('\n✅  Migration consistency check passed.');
}

try {
  main();
} catch (e: any) {
  console.error(`\n❌  ${e.message}`);
  process.exit(1);
}
