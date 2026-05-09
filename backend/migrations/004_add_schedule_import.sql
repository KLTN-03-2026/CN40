-- =============================================================
-- Migration 004: Add schedule-import support
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Related plan: plans/260420-0816-schedule-image-import-ocr/phase-01-database-schema.md
-- =============================================================

-- -----------------------------------------------------------
-- 1. task_instances: source tracking + priority + batch + meta
--    All columns nullable → zero breakage for existing rows.
-- -----------------------------------------------------------

ALTER TABLE "task_instances"
  ADD COLUMN IF NOT EXISTS source          TEXT     NULL,
  ADD COLUMN IF NOT EXISTS priority_rank   SMALLINT NULL,
  ADD COLUMN IF NOT EXISTS import_batch_id UUID     NULL,
  ADD COLUMN IF NOT EXISTS meta            JSONB    NULL;

-- CHECK constraints added separately so IF NOT EXISTS works across Postgres versions.
-- source values: manual | ocr_study | ocr_work | ai
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_task_instances_source'
  ) THEN
    ALTER TABLE "task_instances"
      ADD CONSTRAINT chk_task_instances_source
      CHECK (source IS NULL OR source IN ('manual','ocr_study','ocr_work','ai'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_task_instances_priority_rank'
  ) THEN
    ALTER TABLE "task_instances"
      ADD CONSTRAINT chk_task_instances_priority_rank
      CHECK (priority_rank IS NULL OR priority_rank BETWEEN 1 AND 9);
  END IF;
END $$;

-- meta holds: { courseCode, campus, location, confidence, sourceRow }

-- Indexes to speed up batch lookup + overlap detection
CREATE INDEX IF NOT EXISTS idx_task_instances_batch
  ON "task_instances"(import_batch_id);

CREATE INDEX IF NOT EXISTS idx_task_instances_user_time
  ON "task_instances"(user_id, start_at, end_at);

-- -----------------------------------------------------------
-- 2. Users: academic level for prompt selection + tiết timing
--    5 values cover Cấp 2 / Cấp 3 / Đại học / Đi làm / Khác.
-- -----------------------------------------------------------

ALTER TABLE "Users"
  ADD COLUMN IF NOT EXISTS "HocVan" TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_hocvan'
  ) THEN
    ALTER TABLE "Users"
      ADD CONSTRAINT chk_users_hocvan
      CHECK ("HocVan" IS NULL OR "HocVan" IN ('thcs','thpt','dai_hoc','di_lam','khac'));
  END IF;
END $$;

-- thcs    = Cấp 2 (middle school)
-- thpt    = Cấp 3 (high school)
-- dai_hoc = Đại học (university — enables mã môn + cơ sở display)
-- di_lam  = Đang đi làm (work-only, no study parsing)
-- khac    = Khác (other)

-- =============================================================
-- END OF MIGRATION
--
-- Rollback:
--   ALTER TABLE "task_instances"
--     DROP CONSTRAINT IF EXISTS chk_task_instances_source,
--     DROP CONSTRAINT IF EXISTS chk_task_instances_priority_rank,
--     DROP COLUMN IF EXISTS source,
--     DROP COLUMN IF EXISTS priority_rank,
--     DROP COLUMN IF EXISTS import_batch_id,
--     DROP COLUMN IF EXISTS meta;
--   DROP INDEX IF EXISTS idx_task_instances_batch;
--   DROP INDEX IF EXISTS idx_task_instances_user_time;
--   ALTER TABLE "Users"
--     DROP CONSTRAINT IF EXISTS chk_users_hocvan,
--     DROP COLUMN IF EXISTS "HocVan";
-- =============================================================
