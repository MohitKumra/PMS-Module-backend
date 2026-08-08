/**
 * Scans committed migration SQL for destructive operations (DROP/TRUNCATE/ALTER COLUMN).
 * Warns (non-blocking) by default; use --fail-on-destructive to fail on HIGH severity.
 * Never auto-approves destructive changes (spec §20).
 */
import * as fs from 'fs';
import * as path from 'path';

const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'prisma', 'migrations');
const FAIL = process.argv.includes('--fail-on-destructive');

const PATTERNS: Array<{ name: string; regex: RegExp; severity: 'HIGH' | 'MEDIUM' }> = [
  { name: 'DROP TABLE', regex: /\bDROP\s+TABLE\b/i, severity: 'HIGH' },
  { name: 'DROP COLUMN', regex: /\bDROP\s+COLUMN\b/i, severity: 'HIGH' },
  { name: 'TRUNCATE', regex: /\bTRUNCATE\b/i, severity: 'HIGH' },
  { name: 'DROP INDEX', regex: /\bDROP\s+INDEX\b/i, severity: 'MEDIUM' },
  { name: 'ALTER COLUMN', regex: /\bALTER\s+COLUMN\b/i, severity: 'MEDIUM' },
  { name: 'DELETE FROM', regex: /\bDELETE\s+FROM\b/i, severity: 'MEDIUM' },
];

function main(): void {
  console.log('🔍  Scanning migrations for destructive operations...\n');
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error('❌  prisma/migrations directory not found.');
    process.exit(1);
  }

  const dirs = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{14}_/.test(d.name))
    .map((d) => d.name)
    .sort();

  const warnings: string[] = [];
  for (const dir of dirs) {
    const folder = path.join(MIGRATIONS_DIR, dir);
    const sqlFiles = fs.existsSync(folder) ? fs.readdirSync(folder).filter((f) => f.endsWith('.sql')) : [];
    for (const file of sqlFiles) {
      const lines = fs.readFileSync(path.join(folder, file), 'utf8').split('\n');
      lines.forEach((line, idx) => {
        for (const p of PATTERNS) {
          if (p.regex.test(line)) {
            warnings.push(`${dir}/${file}:${idx + 1} [${p.severity}] ${p.name}: ${line.trim()}`);
          }
        }
      });
    }
  }

  if (warnings.length === 0) {
    console.log('✅  No destructive operations detected in the migration chain.\n');
  } else {
    const high = warnings.filter((w) => w.includes('[HIGH]'));
    const medium = warnings.filter((w) => w.includes('[MEDIUM]'));
    console.log(`⚠️   Found ${warnings.length} potentially destructive operation(s):\n`);
    [...high, ...medium].forEach((w) => console.log(`  - ${w}`));
    console.log('\n  👉  These require HUMAN REVIEW before production deployment.');
    console.log('      The pipeline does NOT auto-approve destructive changes.');
    if (FAIL && high.length > 0) {
      console.error('\n❌  --fail-on-destructive was passed; failing the check.');
      process.exit(1);
    }
  }
  console.log('ℹ️   Warning scan complete. Run with --fail-on-destructive to fail CI on HIGH severity.');
  process.exit(0);
}

main();
