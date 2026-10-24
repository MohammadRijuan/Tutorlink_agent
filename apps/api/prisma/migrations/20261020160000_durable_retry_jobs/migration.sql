ALTER TABLE "JobRun"
  ADD COLUMN "payload" JSONB,
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "lastErrorCategory" TEXT,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "completedAt" TIMESTAMP(3);

ALTER TABLE "JobRun" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "JobRun" ALTER COLUMN "status" SET DEFAULT 'PENDING';

CREATE INDEX "JobRun_jobKey_status_nextAttemptAt_idx"
  ON "JobRun"("jobKey", "status", "nextAttemptAt");
CREATE INDEX "JobRun_status_leaseExpiresAt_idx"
  ON "JobRun"("status", "leaseExpiresAt");
