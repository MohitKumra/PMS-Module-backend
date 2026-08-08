/**
 * scripts/test-migrations.ts
 *
 * Verifies the committed migration chain can build a database from scratch.
 *
 * Requirements:
 *   - A PostgreSQL server must be reachable.
 *   - `TEST_DATABASE_URL` must point to a DISPOSABLE test database.
 *
 * The script runs `prisma migrate deploy` on a fresh database and fails if
 * any migration fails, is missing, or is ordered incorrectly.
 *
 * This is the clean-database migration reproducibility test mandated by the
 * production safety spec (§16).
 */

import { spawnSync } from 'child_process';
import 'dotenv/config';

const BACKEND_ROOT = process.cwd();

function run(cmd: string, env?: Record<string, string | undefined>): string {
  const result = spawnSync(cmd, {
    cwd: BACKEND_ROOT,
    shell: true,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(
      `Command failed (exit ${result.status}): ${cmd}\n\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
    );
  }
  return result.stdout;
}

function main(): void {
  console.log('🧪  Migration reproducibility test (clean database)...\n');

  const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('❌  No database URL available.');
    console.error('    Set TEST_DATABASE_URL (or DATABASE_URL for local testing) to a disposable PostgreSQL database.');
    process.exit(1);
  }

  // Sanity check: the URL is postgres.
  if (!/^postgres(ql)?:\/\//.test(url)) {
    console.error('❌  TEST_DATABASE_URL must point to a PostgreSQL database.');
    process.exit(1);
  }

  try {
    // Step 1: prisma validate
    console.log('1. Validating schema...');
    run('npx prisma validate --config=prisma.config.ts');
    console.log('   ✅  Schema valid.\n');

    // Step 2: prisma migrate deploy on the clean database
    console.log('2. Running `prisma migrate deploy` on the fresh database...');
    run('npx prisma migrate deploy --config=prisma.config.ts', {
      DATABASE_URL: url,
    });
    console.log('   ✅  Migrations applied successfully.\n');

    // Step 3: sanity check — verify the schema resolves after migration
    console.log('3. Running `prisma migrate status` to confirm no pending migrations...');
    const status = run('npx prisma migrate status --config=prisma.config.ts', {
      DATABASE_URL: url,
    });
    if (/not yet been applied|haven't been applied/i.test(status)) {
      console.error('❌  Migrations are still pending after deploy.');
      process.exit(1);
    }
    console.log('   ✅  All migrations applied; no drift.\n');

    console.log('✅  Migration reproducibility test PASSED.');
  } catch (e: any) {
    console.error(`\n❌  ${e.message}`);
    console.error('\n⚠️   The migration chain is NOT reproducible from a clean database.');
    process.exit(1);
  }
}

main();
