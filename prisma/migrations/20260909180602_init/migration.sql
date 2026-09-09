-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'WAITING_PAYMENT', 'PAID', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('ROBUX', 'KOSTUM');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "robloxUsername" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderCode" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "productType" "ProductType" NOT NULL DEFAULT 'ROBUX',
    "robloxUsername" TEXT,
    "robuxAmount" INTEGER,
    "price" INTEGER NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "ticketChannelId" TEXT,
    "paymentProofUrl" TEXT,
    "verifiedBy" TEXT,
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentSetting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "qris" TEXT,
    "qrisImageUrl" TEXT,
    "dana" TEXT,
    "ovo" TEXT,
    "gopay" TEXT,
    "bankName" TEXT,
    "bankAccount" TEXT,
    "bankAccountName" TEXT,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotSetting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "robuxPricePerUnit" INTEGER NOT NULL DEFAULT 160,
    "staffRoleId" TEXT,
    "adminRoleId" TEXT,
    "logChannelId" TEXT,
    "orderCategoryId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionLog" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_discordId_key" ON "User"("discordId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderCode_key" ON "Order"("orderCode");

-- CreateIndex
CREATE UNIQUE INDEX "Order_ticketChannelId_key" ON "Order"("ticketChannelId");

-- CreateIndex
CREATE INDEX "Order_discordId_idx" ON "Order"("discordId");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "TransactionLog_orderId_idx" ON "TransactionLog"("orderId");

-- AddForeignKey
ALTER TABLE "TransactionLog" ADD CONSTRAINT "TransactionLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
