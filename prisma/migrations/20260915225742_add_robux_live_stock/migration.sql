-- AlterTable
ALTER TABLE "BotSetting" ADD COLUMN     "robloxCookieOverride" TEXT,
ADD COLUMN     "robuxStockCache" INTEGER,
ADD COLUMN     "robuxStockError" TEXT,
ADD COLUMN     "robuxStockUpdatedAt" TIMESTAMP(3);
