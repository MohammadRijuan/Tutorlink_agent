-- Supporting sentence shown on the banner, the colour palette used (so consecutive posts never look alike),
-- and the 1200x630 image used by the native "Send Message" link-card post.
ALTER TABLE "ContentItem" ADD COLUMN IF NOT EXISTS "subtitle" TEXT;
ALTER TABLE "ContentItem" ADD COLUMN IF NOT EXISTS "designPalette" TEXT;
ALTER TABLE "ContentItem" ADD COLUMN IF NOT EXISTS "linkAssetUrl" TEXT;
