CREATE TABLE "UserActivityDay" (
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "organizationId" TEXT,
    "firstActivityAt" TIMESTAMPTZ(3) NOT NULL,
    "lastLoginAt" TIMESTAMPTZ(3),
    "loginCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "UserActivityDay_pkey" PRIMARY KEY ("userId", "day"),
    CONSTRAINT "UserActivityDay_loginCount_check" CHECK ("loginCount" >= 0)
);
CREATE INDEX "UserActivityDay_organizationId_day_idx" ON "UserActivityDay"("organizationId", "day");
CREATE INDEX "UserActivityDay_day_idx" ON "UserActivityDay"("day");
