CREATE TABLE "MetaWebhookEvent" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "senderId" TEXT,
  "postId" TEXT,
  "messageText" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MetaWebhookEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MetaWebhookEvent_eventId_key" ON "MetaWebhookEvent"("eventId");
CREATE INDEX "MetaWebhookEvent_eventType_receivedAt_idx" ON "MetaWebhookEvent"("eventType", "receivedAt");
CREATE INDEX "MetaWebhookEvent_senderId_receivedAt_idx" ON "MetaWebhookEvent"("senderId", "receivedAt");
