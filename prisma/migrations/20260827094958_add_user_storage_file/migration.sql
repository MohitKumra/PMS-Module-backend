-- CreateTable
CREATE TABLE "UserStorageFile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "folder" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserStorageFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserStorageFile_url_key" ON "UserStorageFile"("url");

-- CreateIndex
CREATE INDEX "UserStorageFile_userId_idx" ON "UserStorageFile"("userId");

-- AddForeignKey
ALTER TABLE "UserStorageFile" ADD CONSTRAINT "UserStorageFile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
