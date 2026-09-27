-- Multi-tenant: setiap server Discord (guildId) jadi toko independen sendiri.
-- Data lama dianggap milik guild yang sekarang dipakai bot (DISCORD_GUILD_ID di .env).
-- Ganti '1443954404406595654' di bawah SEBELUM deploy kalau server produksi Anda beda.

-- ===== Order: tambah guildId (wajib), backfill data lama =====
ALTER TABLE "Order" ADD COLUMN "guildId" TEXT;
UPDATE "Order" SET "guildId" = '1443954404406595654' WHERE "guildId" IS NULL;
ALTER TABLE "Order" ALTER COLUMN "guildId" SET NOT NULL;
CREATE INDEX "Order_guildId_idx" ON "Order"("guildId");
CREATE INDEX "Order_guildId_discordId_idx" ON "Order"("guildId", "discordId");

-- ===== BotSetting: dari singleton (id=1) jadi 1 baris per guildId =====
ALTER TABLE "BotSetting" ADD COLUMN "guildId" TEXT;
UPDATE "BotSetting" SET "guildId" = '1443954404406595654' WHERE "guildId" IS NULL;
ALTER TABLE "BotSetting" ALTER COLUMN "guildId" SET NOT NULL;
ALTER TABLE "BotSetting" DROP CONSTRAINT "BotSetting_pkey";
ALTER TABLE "BotSetting" ADD CONSTRAINT "BotSetting_pkey" PRIMARY KEY ("guildId");
ALTER TABLE "BotSetting" DROP COLUMN "id";

-- ===== PaymentSetting: dari singleton (id=1) jadi 1 baris per guildId =====
ALTER TABLE "PaymentSetting" ADD COLUMN "guildId" TEXT;
UPDATE "PaymentSetting" SET "guildId" = '1443954404406595654' WHERE "guildId" IS NULL;
ALTER TABLE "PaymentSetting" ALTER COLUMN "guildId" SET NOT NULL;
ALTER TABLE "PaymentSetting" DROP CONSTRAINT "PaymentSetting_pkey";
ALTER TABLE "PaymentSetting" ADD CONSTRAINT "PaymentSetting_pkey" PRIMARY KEY ("guildId");
ALTER TABLE "PaymentSetting" DROP COLUMN "id";

-- ===== RobloxAccount: tambah guildId (wajib), backfill kalau sudah ada baris =====
ALTER TABLE "RobloxAccount" ADD COLUMN "guildId" TEXT;
UPDATE "RobloxAccount" SET "guildId" = '1443954404406595654' WHERE "guildId" IS NULL;
ALTER TABLE "RobloxAccount" ALTER COLUMN "guildId" SET NOT NULL;
DROP INDEX IF EXISTS "RobloxAccount_active_idx";
CREATE INDEX "RobloxAccount_guildId_active_idx" ON "RobloxAccount"("guildId", "active");

-- ===== TransactionLog: tambah guildId (opsional), backfill dari Order yang terhubung =====
ALTER TABLE "TransactionLog" ADD COLUMN "guildId" TEXT;
UPDATE "TransactionLog" t
SET "guildId" = o."guildId"
FROM "Order" o
WHERE t."orderId" = o."id" AND t."guildId" IS NULL;
CREATE INDEX "TransactionLog_guildId_idx" ON "TransactionLog"("guildId");
