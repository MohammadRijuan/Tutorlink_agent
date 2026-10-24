-- Persist the creative strategy and visual template used for each generated draft.
ALTER TABLE "ContentItem"
  ADD COLUMN "creativeAngle" TEXT,
  ADD COLUMN "visualStyle" TEXT;

CREATE INDEX "ContentItem_creativeAngle_createdAt_idx"
  ON "ContentItem"("creativeAngle", "createdAt");
CREATE INDEX "ContentItem_visualStyle_createdAt_idx"
  ON "ContentItem"("visualStyle", "createdAt");
