-- Manajemen akun Redfinger: hanya menambah tabel/enum baru, tidak mengubah tabel lama.
-- CreateEnum
CREATE TYPE "RedfingerStatus" AS ENUM ('ACTIVE', 'EXPIRING', 'RENEWING', 'EXPIRED', 'REPLACING', 'REPLACED', 'FAILED', 'DISABLED');

-- CreateEnum
CREATE TYPE "RedfingerJobType" AS ENUM ('RENEW', 'REPLACE');

-- CreateEnum
CREATE TYPE "RedfingerJobMode" AS ENUM ('MANUAL', 'BROWSER');

-- CreateEnum
CREATE TYPE "RedfingerJobStatus" AS ENUM ('STARTED', 'SUCCESS', 'FAILED', 'NEEDS_VERIFICATION', 'CANCELLED');

-- CreateTable
CREATE TABLE "RedfingerAccount" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "username" TEXT,
    "passwordEncrypted" TEXT,
    "instanceId" TEXT,
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "RedfingerStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "replacedById" TEXT,
    "replacesId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RedfingerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedfingerReminder" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "stage" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RedfingerReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedfingerJob" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "RedfingerJobType" NOT NULL,
    "mode" "RedfingerJobMode" NOT NULL,
    "status" "RedfingerJobStatus" NOT NULL DEFAULT 'STARTED',
    "message" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "RedfingerJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedfingerAuditLog" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "accountId" TEXT,
    "action" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RedfingerAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedfingerSetting" (
    "guildId" TEXT NOT NULL,
    "adminChannelId" TEXT,
    "logChannelId" TEXT,
    "adminRoleId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RedfingerSetting_pkey" PRIMARY KEY ("guildId")
);

-- CreateIndex
CREATE INDEX "RedfingerAccount_guildId_status_idx" ON "RedfingerAccount"("guildId", "status");

-- CreateIndex
CREATE INDEX "RedfingerAccount_status_dueDate_idx" ON "RedfingerAccount"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "RedfingerAccount_guildId_code_key" ON "RedfingerAccount"("guildId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "RedfingerReminder_accountId_dueDate_stage_key" ON "RedfingerReminder"("accountId", "dueDate", "stage");

-- CreateIndex
CREATE INDEX "RedfingerJob_accountId_status_idx" ON "RedfingerJob"("accountId", "status");

-- CreateIndex
CREATE INDEX "RedfingerAuditLog_guildId_createdAt_idx" ON "RedfingerAuditLog"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "RedfingerAuditLog_accountId_idx" ON "RedfingerAuditLog"("accountId");

-- AddForeignKey
ALTER TABLE "RedfingerReminder" ADD CONSTRAINT "RedfingerReminder_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "RedfingerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedfingerJob" ADD CONSTRAINT "RedfingerJob_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "RedfingerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

