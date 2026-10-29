-- CreateTable
CREATE TABLE "PinAnalyticsDaily" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "scheduledPinId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "pinClicks" INTEGER NOT NULL DEFAULT 0,
    "outboundClicks" INTEGER NOT NULL DEFAULT 0,
    "saves" INTEGER NOT NULL DEFAULT 0,
    "engagements" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PinAnalyticsDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiCallLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT,
    "endpoint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiCallLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PinAnalyticsDaily_scheduledPinId_date_key" ON "PinAnalyticsDaily"("scheduledPinId", "date");

-- CreateIndex
CREATE INDEX "PinAnalyticsDaily_userId_date_idx" ON "PinAnalyticsDaily"("userId", "date");

-- CreateIndex
CREATE INDEX "ApiCallLog_userId_createdAt_idx" ON "ApiCallLog"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "PinAnalyticsDaily" ADD CONSTRAINT "PinAnalyticsDaily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PinAnalyticsDaily" ADD CONSTRAINT "PinAnalyticsDaily_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "PinterestConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PinAnalyticsDaily" ADD CONSTRAINT "PinAnalyticsDaily_scheduledPinId_fkey" FOREIGN KEY ("scheduledPinId") REFERENCES "ScheduledPin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiCallLog" ADD CONSTRAINT "ApiCallLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiCallLog" ADD CONSTRAINT "ApiCallLog_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "PinterestConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
