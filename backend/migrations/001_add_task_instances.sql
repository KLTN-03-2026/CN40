-- =============================================================
-- Migration 001: Add task_instances table + fixed-time columns
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- =============================================================

-- -----------------------------------------------------------
-- 1. Add fixed-time columns to CongViec (tasks template)
--    Note: CoThoiGianCoDinh / GioBatDauCoDinh / GioKetThucCoDinh
--    already exist. We add new normalized English aliases +
--    default_duration_minutes for AI scheduling hints.
-- -----------------------------------------------------------

ALTER TABLE "CongViec"
  ADD COLUMN IF NOT EXISTS is_fixed               BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fixed_start            TIMESTAMPTZ  NULL,
  ADD COLUMN IF NOT EXISTS fixed_end              TIMESTAMPTZ  NULL,
  ADD COLUMN IF NOT EXISTS default_duration_minutes INT         NULL;

-- Backfill from legacy columns so existing data is preserved
UPDATE "CongViec"
SET
  is_fixed    = COALESCE("CoThoiGianCoDinh", false),
  fixed_start = "GioBatDauCoDinh",
  fixed_end   = "GioKetThucCoDinh"
WHERE is_fixed IS DISTINCT FROM COALESCE("CoThoiGianCoDinh", false)
   OR fixed_start IS DISTINCT FROM "GioBatDauCoDinh"
   OR fixed_end   IS DISTINCT FROM "GioKetThucCoDinh";

-- -----------------------------------------------------------
-- 2. Create task_instances table
--    One row = one scheduled occurrence of a task template.
--    Drag/resize an instance → only this row changes, not CongViec.
-- -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS "task_instances" (
  "id"         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "task_id"    INTEGER     NULL,        -- FK → CongViec.MaCongViec (integer serial); NULL = standalone event
  "user_id"    INTEGER     NOT NULL,
  "start_at"   TIMESTAMPTZ NOT NULL,
  "end_at"     TIMESTAMPTZ NOT NULL,
  "title"      TEXT        NULL,        -- override title (null = use task title)
  "note"       TEXT        NULL,
  "status"     TEXT        NOT NULL DEFAULT 'scheduled'
                           CHECK ("status" IN ('scheduled', 'completed', 'cancelled')),
  "is_ai_suggested" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_task_instances_task
    FOREIGN KEY ("task_id") REFERENCES "CongViec"("MaCongViec") ON DELETE CASCADE
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_task_instances_task_id
  ON "task_instances" ("task_id");

CREATE INDEX IF NOT EXISTS idx_task_instances_start_at
  ON "task_instances" ("start_at");

CREATE INDEX IF NOT EXISTS idx_task_instances_user_id
  ON "task_instances" ("user_id");

-- -----------------------------------------------------------
-- 3. Data migration: copy existing LichTrinh rows into
--    task_instances so no scheduling data is lost.
--    LichTrinh is kept intact for full backward compatibility.
-- -----------------------------------------------------------

INSERT INTO "task_instances" (
  "id",
  "task_id",
  "user_id",
  "start_at",
  "end_at",
  "title",
  "note",
  "status",
  "is_ai_suggested",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid()                AS id,
  -- task_id: LichTrinh.MaCongViec is integer, matching CongViec.MaCongViec (integer serial).
  -- Only populate when a matching CongViec row exists (guards against orphan FKs).
  CASE WHEN EXISTS (
    SELECT 1 FROM "CongViec" cv WHERE cv."MaCongViec" = lt."MaCongViec"
  ) THEN lt."MaCongViec" ELSE NULL END AS task_id,
  lt."UserID"                      AS user_id,
  lt."GioBatDau"                   AS start_at,
  COALESCE(lt."GioKetThuc", lt."GioBatDau" + INTERVAL '1 hour') AS end_at,
  lt."TieuDe"                      AS title,
  lt."GhiChu"                      AS note,
  CASE WHEN lt."DaHoanThanh" = true THEN 'completed' ELSE 'scheduled' END AS status,
  COALESCE(lt."AI_DeXuat", false)  AS is_ai_suggested,
  COALESCE(lt."NgayTao", now())    AS created_at,
  now()                            AS updated_at
FROM "LichTrinh" lt
WHERE lt."GioBatDau" IS NOT NULL
  AND lt."UserID" IS NOT NULL
  -- Skip rows that were already migrated (idempotency guard)
  AND NOT EXISTS (
    SELECT 1 FROM "task_instances" ti
    WHERE ti.user_id = lt."UserID"
      AND ti.start_at = lt."GioBatDau"
      AND COALESCE(ti.title, '') = COALESCE(lt."TieuDe", '')
  );

-- NOTE: task_id is integer matching CongViec.MaCongViec. The FK CASCADE ensures
-- that deleting a task automatically removes its scheduled instances.
-- RLS is intentionally NOT enabled — this project uses backend JWT auth with the
-- anon key, matching the convention of all other tables (CongViec, LichTrinh, etc.).
-- User isolation is enforced by the user_id = req.userId WHERE clause in routes.

-- =============================================================
-- END OF MIGRATION
-- To roll back: DROP TABLE IF EXISTS "task_instances";
--               ALTER TABLE "CongViec" DROP COLUMN IF EXISTS is_fixed,
--                 DROP COLUMN IF EXISTS fixed_start,
--                 DROP COLUMN IF EXISTS fixed_end,
--                 DROP COLUMN IF EXISTS default_duration_minutes;
-- =============================================================
