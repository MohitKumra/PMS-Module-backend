// backend/scripts/backfill-orphan-subscriptions.ts
// One-time backfill: for already-CAPTURED billing transactions that have a plan
// but no linked subscription (created before subscription activation was wired
// into recordSuccessfulPayment), create an ACTIVE local Subscription so the
// user's entitlements resolve to the paid plan instead of the Free tier.
//
// Idempotent: safe to run multiple times.
//
// Run: npm run backfill:subscriptions

import dotenv from 'dotenv';
dotenv.config();
import { prisma } from '../src/lib/prismaClient';

async function main() {
  // Candidate transactions addressed here are one-time "PAYMENT" rows (no
  // provider subscription) that captured a plan amount.
  const orphans = await prisma.billingTransaction.findMany({
    where: {
      status: 'CAPTURED',
      subscriptionId: null,
      planId: { not: null },
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Found ${orphans.length} captured transaction(s) without a subscription.\n`);

  let created = 0;
  let linked = 0;
  let skipped = 0;

  for (const tx of orphans) {
    if (!tx.planId) continue;
    const plan = await prisma.plan.findUnique({ where: { id: tx.planId } });
    if (!plan) {
      skipped += 1;
      console.warn(`  ↷ tx ${tx.id}: plan ${tx.planId} not found, skipped`);
      continue;
    }

    // Idempotency: reuse an active/past-due subscription for this user+plan, or
    // one already created for this purchase (keyed by the transaction id).
    const existingSub = await prisma.subscription.findFirst({
      where: {
        userId: tx.userId,
        planId: tx.planId,
        OR: [
          { status: { in: ['ACTIVE', 'PAST_DUE'] } },
          { providerSubscriptionId: `backfill_${tx.id}` },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });

    if (existingSub) {
      // Link this transaction (and any invoice) to the existing subscription.
      if (existingSub.userId !== tx.userId) {
        skipped += 1;
        console.warn(`  ↷ tx ${tx.id}: active sub belongs to another user, skipped`);
        continue;
      }
      await prisma.billingTransaction.update({
        where: { id: tx.id },
        data: { subscriptionId: existingSub.id },
      });
      if (tx.invoiceId) {
        await prisma.invoice.update({
          where: { id: tx.invoiceId },
          data: { subscriptionId: existingSub.id },
        });
      }
      linked += 1;
      console.log(`  → tx ${tx.id}: linked to existing sub ${existingSub.id}`);
      continue;
    }

    const anchor = tx.paidAt || tx.createdAt || new Date();
    const isYearly = plan.billingInterval === 'YEAR';
    const periodEnd = new Date(
      anchor.getTime() + (isYearly ? 365 : 30) * 24 * 60 * 60 * 1000
    );

    const sub = await prisma.subscription.create({
      data: {
        userId: tx.userId,
        planId: plan.id,
        provider: tx.provider || 'razorpay',
        providerSubscriptionId: `backfill_${tx.id}`,
        status: 'ACTIVE',
        billingInterval: plan.billingInterval,
        quantity: 1,
        currentPeriodStart: anchor,
        currentPeriodEnd: periodEnd,
        startedAt: anchor,
        autoRenew: false,
      },
    });

    await prisma.subscriptionEvent.create({
      data: {
        subscriptionId: sub.id,
        eventType: 'ACTIVATED',
        provider: tx.provider || 'razorpay',
        occurredAt: anchor,
      },
    });

    await prisma.billingTransaction.update({
      where: { id: tx.id },
      data: { subscriptionId: sub.id },
    });
    if (tx.invoiceId) {
      await prisma.invoice.update({
        where: { id: tx.invoiceId },
        data: { subscriptionId: sub.id },
      });
    }

    created += 1;
    console.log(
      `  ✓ tx ${tx.id}: activated ${plan.name} (${plan.billingInterval}) for user ${tx.userId} until ${periodEnd.toISOString()}`
    );
  }

  console.log(
    `\nDone. Created ${created}, linked-to-existing ${linked}, skipped ${skipped}.`
  );

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});