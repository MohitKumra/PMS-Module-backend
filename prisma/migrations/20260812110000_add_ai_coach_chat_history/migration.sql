-- CreateEnum
CREATE TYPE "CoachChatRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateTable
CREATE TABLE "AICoachChat" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'New chat',
    "summary" TEXT NOT NULL DEFAULT '',
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AICoachChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AICoachMessage" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "role" "CoachChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AICoachMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AICoachChat_userId_lastMessageAt_idx" ON "AICoachChat"("userId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "AICoachChat_userId_createdAt_idx" ON "AICoachChat"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AICoachMessage_chatId_createdAt_idx" ON "AICoachMessage"("chatId", "createdAt");

-- AddForeignKey
ALTER TABLE "AICoachChat" ADD CONSTRAINT "AICoachChat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AICoachMessage" ADD CONSTRAINT "AICoachMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "AICoachChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
