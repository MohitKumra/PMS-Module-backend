/**
 * backfill-goal-progress.ts
 *
 * One-time deploy script: recomputes and persists progress for every goal
 * using the new fully-dynamic multi-factor engine (Milestones / Tasks /
 * Projects / Habits). Run after the migration that drops `manualProgress`.
 *
 * Usage:
 *   npx tsx src/scripts/backfill-goal-progress.ts
 */
import { prisma } from '../lib/prismaClient';
import { recomputeGoalProgress } from '../services/goal.service';

async function main() {
  const goals = await prisma.goal.findMany({ select: { id: true } });
  console.log(`Found ${goals.length} goal(s) to backfill.`);

  let updated = 0;
  for (const goal of goals) {
    try {
      await recomputeGoalProgress(goal.id);
      updated++;
    } catch (err: any) {
      console.error(`Failed to recompute goal ${goal.id}:`, err?.message || err);
    }
  }

  console.log(`Backfill complete. Updated ${updated}/${goals.length} goal(s).`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Backfill failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
