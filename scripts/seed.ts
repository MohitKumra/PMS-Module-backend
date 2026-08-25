// backend/scripts/seed.ts
// Idempotent database seeding script for plans and initial administrator.

import dotenv from 'dotenv';
dotenv.config();
import { prisma } from '../src/lib/prismaClient';
import { bootstrapAdmin } from '../src/services/adminAuth.service';

const INITIAL_PLANS = [
  {
    slug: 'free',
    name: 'Free',
    description: 'Essential personal productivity suite',
    currency: 'INR',
    priceCents: 0,
    billingInterval: 'MONTH' as const,
    sortOrder: 0,
    features: {
      aiRequestsPerMonth: 50,
      projects: 3,
      habits: 5,
      tasks: 100,
      storageMb: 100,
    },
  },
  {
    slug: 'basic',
    name: 'Basic',
    description: 'For individuals seeking enhanced focus & analytics',
    currency: 'INR',
    priceCents: 49900,
    billingInterval: 'MONTH' as const,
    sortOrder: 1,
    features: {
      aiRequestsPerMonth: 1000,
      projects: 10,
      habits: 20,
      tasks: 500,
      storageMb: 1000,
    },
  },
  {
    slug: 'premium',
    name: 'Premium',
    description: 'Complete power user productivity system',
    currency: 'INR',
    priceCents: 99900,
    billingInterval: 'MONTH' as const,
    sortOrder: 2,
    features: {
      aiRequestsPerMonth: 5000,
      projects: 50,
      habits: 100,
      tasks: 2500,
      storageMb: 5000,
      voiceNotes: true,
      audioRecurrence: true,
    },
  },
  {
    slug: 'ultimate',
    name: 'Ultimate',
    description: 'Maximum AI capabilities, unlimited workspaces, and priority support',
    currency: 'INR',
    priceCents: 199900,
    billingInterval: 'MONTH' as const,
    sortOrder: 3,
    features: {
      aiRequestsPerMonth: 25000,
      projects: 500,
      habits: 500,
      tasks: 10000,
      storageMb: 25000,
      voiceNotes: true,
      audioRecurrence: true,
      prioritySupport: true,
      teamMembers: 5,
    },
  },
];

async function main() {
  console.log('🌱 Starting database seed (INR Currency)...');

  // 1. Seed Plans
  for (const p of INITIAL_PLANS) {
    const existing = await prisma.plan.findUnique({
      where: { slug: p.slug },
    });

    if (!existing) {
      const plan = await prisma.plan.create({
        data: {
          slug: p.slug,
          name: p.name,
          description: p.description,
          currency: p.currency,
          priceCents: p.priceCents,
          billingInterval: p.billingInterval,
          sortOrder: p.sortOrder,
          features: p.features,
          isActive: true,
          version: 1,
        },
      });

      if (p.priceCents > 0) {
        await prisma.paymentProviderPlan.create({
          data: {
            planId: plan.id,
            provider: 'razorpay',
            providerPlanId: `plan_seed_${p.slug}`,
            currency: p.currency,
            amountCents: p.priceCents,
            billingInterval: p.billingInterval,
            isActive: true,
          },
        });
      }
      console.log(`  ✓ Plan seeded: ${p.name} (₹${p.priceCents / 100}/${p.billingInterval.toLowerCase()})`);
    } else {
      // Update currency and prices if they were in USD
      if (existing.currency !== 'INR') {
        await prisma.plan.update({
          where: { id: existing.id },
          data: {
            currency: 'INR',
            priceCents: p.priceCents,
          },
        });
        console.log(`  ✓ Plan updated to INR: ${p.name} (₹${p.priceCents / 100}/${p.billingInterval.toLowerCase()})`);
      } else {
        console.log(`  ℹ Plan already exists: ${p.name} (preserved)`);
      }
    }
  }

  // 2. Bootstrap initial super administrator idempotently
  await bootstrapAdmin();

  console.log('✅ Seed completed successfully.');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });