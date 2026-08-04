-- CreateTable
CREATE TABLE "AIPreference" (
    "userId" TEXT NOT NULL,
    "dailyBriefEnabled" BOOLEAN NOT NULL DEFAULT true,
    "journalWeeklyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "insightsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "coachEnabled" BOOLEAN NOT NULL DEFAULT true,
    "journalAnalysisEnabled" BOOLEAN NOT NULL DEFAULT true,
    "goalSummaryEnabled" BOOLEAN NOT NULL DEFAULT true,
    "taskParserEnabled" BOOLEAN NOT NULL DEFAULT true,
    "goalPlannerEnabled" BOOLEAN NOT NULL DEFAULT true,
    "summaryRefreshMinutes" INTEGER NOT NULL DEFAULT 60,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AIPreference_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "AIPreference" ADD CONSTRAINT "AIPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
