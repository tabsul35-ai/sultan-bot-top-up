-- CreateTable
CREATE TABLE "RobloxAccount" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "cookie" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "stockCache" INTEGER,
    "stockUpdatedAt" TIMESTAMP(3),
    "stockError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RobloxAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RobloxAccount_active_idx" ON "RobloxAccount"("active");
