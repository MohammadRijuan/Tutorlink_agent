-- Initial schema for TutorLink AI Marketing Manager.
-- Apply only to a dedicated, empty database. Never reset a production database.
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'QUALIFIED', 'UNQUALIFIED', 'CONTACTED', 'BOOKED', 'LOST');
CREATE TYPE "ContentStatus" AS ENUM ('IDEA', 'DRAFT', 'VALIDATED', 'SCHEDULED', 'PUBLISHED', 'FAILED', 'PAUSED');
CREATE TYPE "PublishMode" AS ENUM ('DRY_RUN', 'LIVE');

CREATE TABLE "AdminUser" (
  "id" TEXT NOT NULL, "email" TEXT NOT NULL, "passwordHash" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'ADMIN', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "BusinessProfile" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL DEFAULT 'TutorLink Media',
  "description" TEXT NOT NULL DEFAULT 'Home-tuition matching service in configured service areas.',
  "serviceAreas" JSONB NOT NULL, "supportedPrograms" JSONB NOT NULL, "trustedFacts" JSONB NOT NULL,
  "prohibitedClaims" JSONB NOT NULL, "brandAssetUrls" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BusinessProfile_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PageSnapshot" (
  "id" TEXT NOT NULL, "pageId" TEXT NOT NULL, "pageName" TEXT, "profilePicture" TEXT,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "permissionInfo" JSONB NOT NULL,
  "rawSummary" JSONB NOT NULL, CONSTRAINT "PageSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ContentItem" (
  "id" TEXT NOT NULL, "platformPostId" TEXT, "title" TEXT NOT NULL, "format" TEXT NOT NULL,
  "topic" TEXT NOT NULL, "language" TEXT NOT NULL DEFAULT 'bn', "caption" TEXT NOT NULL,
  "hashtags" JSONB NOT NULL, "callToAction" TEXT, "assetUrl" TEXT, "script" TEXT,
  "status" "ContentStatus" NOT NULL DEFAULT 'IDEA', "scheduledAt" TIMESTAMP(3), "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ContentMetric" (
  "id" TEXT NOT NULL, "contentItemId" TEXT NOT NULL, "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reach" INTEGER, "impressions" INTEGER, "views" INTEGER, "reactions" INTEGER, "comments" INTEGER,
  "shares" INTEGER, "clicks" INTEGER, "watchTimeSeconds" INTEGER, "raw" JSONB NOT NULL,
  CONSTRAINT "ContentMetric_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Lead" (
  "id" TEXT NOT NULL, "externalReference" TEXT, "contactName" TEXT, "contactChannel" TEXT, "contactValue" TEXT,
  "status" "LeadStatus" NOT NULL DEFAULT 'NEW', "qualificationReason" TEXT, "qualificationScore" DOUBLE PRECISION,
  "serviceArea" TEXT, "classLevel" TEXT, "subjects" JSONB, "schedulePreference" TEXT, "budget" TEXT,
  "sourceContentId" TEXT, "attributionConfidence" DOUBLE PRECISION, "bookedAt" TIMESTAMP(3), "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CampaignExperiment" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "hypothesis" TEXT NOT NULL, "variable" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PLANNED', "startAt" TIMESTAMP(3), "endAt" TIMESTAMP(3),
  "sampleSize" INTEGER NOT NULL DEFAULT 0, "result" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "CampaignExperiment_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Experiment" (
  "id" TEXT NOT NULL, "contentItemId" TEXT NOT NULL, "experimentKey" TEXT NOT NULL, "variant" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AgentDecision" (
  "id" TEXT NOT NULL, "runId" TEXT NOT NULL, "category" TEXT NOT NULL, "observation" JSONB NOT NULL,
  "hypothesis" TEXT NOT NULL, "confidence" DOUBLE PRECISION NOT NULL, "action" JSONB NOT NULL,
  "outcome" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentDecision_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SystemSetting" (
  "key" TEXT NOT NULL, "value" JSONB NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);
CREATE TABLE "AuditEvent" (
  "id" TEXT NOT NULL, "actor" TEXT NOT NULL, "action" TEXT NOT NULL, "entityType" TEXT, "entityId" TEXT,
  "details" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "JobRun" (
  "id" TEXT NOT NULL, "jobKey" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RUNNING', "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3), "result" JSONB, "errorCode" TEXT, "errorMessage" TEXT,
  CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");
CREATE INDEX "PageSnapshot_pageId_fetchedAt_idx" ON "PageSnapshot"("pageId", "fetchedAt");
CREATE UNIQUE INDEX "ContentItem_platformPostId_key" ON "ContentItem"("platformPostId");
CREATE INDEX "ContentItem_status_scheduledAt_idx" ON "ContentItem"("status", "scheduledAt");
CREATE INDEX "ContentItem_topic_format_idx" ON "ContentItem"("topic", "format");
CREATE INDEX "ContentMetric_contentItemId_observedAt_idx" ON "ContentMetric"("contentItemId", "observedAt");
CREATE INDEX "Lead_status_createdAt_idx" ON "Lead"("status", "createdAt");
CREATE INDEX "Lead_sourceContentId_idx" ON "Lead"("sourceContentId");
CREATE INDEX "Experiment_experimentKey_variant_idx" ON "Experiment"("experimentKey", "variant");
CREATE INDEX "AgentDecision_runId_createdAt_idx" ON "AgentDecision"("runId", "createdAt");
CREATE INDEX "AuditEvent_action_createdAt_idx" ON "AuditEvent"("action", "createdAt");
CREATE UNIQUE INDEX "JobRun_idempotencyKey_key" ON "JobRun"("idempotencyKey");
CREATE INDEX "JobRun_jobKey_startedAt_idx" ON "JobRun"("jobKey", "startedAt");

ALTER TABLE "ContentMetric" ADD CONSTRAINT "ContentMetric_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_sourceContentId_fkey" FOREIGN KEY ("sourceContentId") REFERENCES "ContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
