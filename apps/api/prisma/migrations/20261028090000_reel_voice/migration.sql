-- Voice-over Reels: the spoken script, the scene plan, and the synthesised voice (stored once, reused for previews and publishing).
ALTER TABLE "ContentItem" ADD COLUMN IF NOT EXISTS "narration" TEXT;
ALTER TABLE "ContentItem" ADD COLUMN IF NOT EXISTS "reelPlan" JSONB;
ALTER TABLE "ContentItem" ADD COLUMN IF NOT EXISTS "voiceAudio" BYTEA;
ALTER TABLE "ContentItem" ADD COLUMN IF NOT EXISTS "voiceSeconds" DOUBLE PRECISION;
ALTER TABLE "ContentItem" ADD COLUMN IF NOT EXISTS "voicePauses" JSONB;
ALTER TABLE "ContentItem" ADD COLUMN IF NOT EXISTS "voiceName" TEXT;
