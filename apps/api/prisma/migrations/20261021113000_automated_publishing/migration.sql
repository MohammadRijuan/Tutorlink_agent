-- Add a durable claim state so two overlapping Cron invocations cannot publish the same content concurrently.
ALTER TYPE "ContentStatus" ADD VALUE IF NOT EXISTS 'PUBLISHING';
