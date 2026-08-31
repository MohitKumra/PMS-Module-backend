-- AlterTable
ALTER TABLE "CustomPlanRequest" ADD COLUMN     "carrierPlanId" TEXT,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "payTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "payTokenHash" TEXT;

-- CreateIndex
CREATE INDEX "CustomPlanRequest_carrierPlanId_idx" ON "CustomPlanRequest"("carrierPlanId");
