-- AlterEnum
ALTER TYPE "SubscriptionEventType" ADD VALUE 'REQUIRES_RECONCILIATION';

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "scheduledChangeAt" TIMESTAMP(3),
ADD COLUMN     "scheduledPlanId" TEXT;
