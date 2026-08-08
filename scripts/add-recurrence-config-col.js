// One-off script: adds recurrenceConfig JSONB column to Task table.
// Safe to run multiple times (IF NOT EXISTS).
// Run with: node scripts/add-recurrence-config-col.js
const { Client } = require('pg');

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/productivity_db?schema=public';

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const res = await client.query(`ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "recurrenceConfig" JSONB`);
    console.log('✓ Column added (or already exists):', res.command);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('✗ Migration failed:', err.message);
  process.exit(1);
});
