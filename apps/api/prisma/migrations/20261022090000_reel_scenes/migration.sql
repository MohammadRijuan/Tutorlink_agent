-- Structured on-screen scenes for rendered Reels (replaces brittle script parsing).
ALTER TABLE "ContentItem" ADD COLUMN IF NOT EXISTS "reelScenes" JSONB;

-- Faster referral/sender lookups for per-post attribution.
CREATE INDEX IF NOT EXISTS "MetaWebhookEvent_senderId_eventType_idx" ON "MetaWebhookEvent"("senderId", "eventType");
