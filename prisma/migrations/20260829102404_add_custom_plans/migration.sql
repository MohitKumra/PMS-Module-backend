-- CreateEnum
CREATE TYPE "CustomPlanRequestStatus" AS ENUM ('PENDING', 'REVIEWING', 'QUOTED', 'ACCEPTED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "CustomPlanRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currentPlanId" TEXT,
    "status" "CustomPlanRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedFeatures" JSONB NOT NULL,
    "requestedLimits" JSONB NOT NULL,
    "requirements" JSONB,
    "adminNotes" TEXT,
    "quotedPriceCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "billingInterval" "BillingInterval",
    "finalConfig" JSONB,
    "adminReviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomPlanRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomPlanRequest_userId_status_idx" ON "CustomPlanRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "CustomPlanRequest_status_createdAt_idx" ON "CustomPlanRequest"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "CustomPlanRequest" ADD CONSTRAINT "CustomPlanRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
