-- Meta Graph API v26 uses media-view metrics; exact post reach/impressions metrics are no longer a reliable per-post field.
ALTER TABLE "ContentMetric" ADD COLUMN "uniqueMediaViews" INTEGER;
