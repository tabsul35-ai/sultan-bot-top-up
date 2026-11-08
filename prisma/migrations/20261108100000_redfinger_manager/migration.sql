-- Redfinger Manager: login (Register) + antrian tugas. Hanya menambah tabel/kolom nullable.
-- CreateEnum
CREATE TYPE "RedfingerLoginStatus" AS ENUM ('PENDING', 'OK', 'BAD_CREDENTIALS', 'NEEDS_VERIFICATION', 'FAILED');

-- CreateEnum
CREATE TYPE "RedfingerTaskType" AS ENUM ('LOGIN_SYNC', 'REDEEM', 'RENEW', 'REPLACE');

-- CreateEnum
CREATE TYPE "RedfingerTaskStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'NEEDS_VERIFICATION');

-- AlterTable
ALTER TABLE "RedfingerAccount" ADD COLUMN     "androidVersion" TEXT,
ADD COLUMN     "loginId" TEXT,
ADD COLUMN     "region" TEXT;

-- CreateTable
CREATE TABLE "RedfingerLogin" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordEncrypted" TEXT NOT NULL,
    "status" "RedfingerLoginStatus" NOT NULL DEFAULT 'PENDING',
    "lastError" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "deviceCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RedfingerLogin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedfingerTask" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "loginId" TEXT,
    "accountId" TEXT,
    "type" "RedfingerTaskType" NOT NULL,
    "status" "RedfingerTaskStatus" NOT NULL DEFAULT 'QUEUED',
    "message" TEXT,
    "actorId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "RedfingerTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RedfingerLogin_guildId_email_key" ON "RedfingerLogin"("guildId", "email");

-- CreateIndex
CREATE INDEX "RedfingerTask_guildId_status_idx" ON "RedfingerTask"("guildId", "status");

-- CreateIndex
CREATE INDEX "RedfingerTask_loginId_idx" ON "RedfingerTask"("loginId");

-- AddForeignKey
ALTER TABLE "RedfingerAccount" ADD CONSTRAINT "RedfingerAccount_loginId_fkey" FOREIGN KEY ("loginId") REFERENCES "RedfingerLogin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedfingerTask" ADD CONSTRAINT "RedfingerTask_loginId_fkey" FOREIGN KEY ("loginId") REFERENCES "RedfingerLogin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

