-- AlterTable
ALTER TABLE "UserPreference" ADD COLUMN "pageTransitionsEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "UserPreference" ADD COLUMN "floatingAnimationsEnabled" BOOLEAN NOT NULL DEFAULT true;
