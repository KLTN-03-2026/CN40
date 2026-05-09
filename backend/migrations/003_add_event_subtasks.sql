-- =============================================================
-- Migration 003: event_subtasks table — minitask stacked under a calendar event
-- Run in Supabase SQL Editor.
-- =============================================================

CREATE TABLE IF NOT EXISTS "event_subtasks" (
  "id"          BIGSERIAL   PRIMARY KEY,
  "event_id"    INTEGER     NOT NULL, -- FK → LichTrinh.MaLichTrinh
  "user_id"     INTEGER     NOT NULL,
  "title"       TEXT        NOT NULL,
  "start_at"    TIMESTAMPTZ NULL,
  "end_at"      TIMESTAMPTZ NULL,
  "note"        TEXT        NULL,
  "is_done"     BOOLEAN     NOT NULL DEFAULT false,
  "position"    INTEGER     NOT NULL DEFAULT 0, -- ordering within the parent event
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_event_subtasks_event
    FOREIGN KEY ("event_id") REFERENCES "LichTrinh"("MaLichTrinh") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_event_subtasks_event_id ON "event_subtasks" ("event_id");
CREATE INDEX IF NOT EXISTS idx_event_subtasks_user_id  ON "event_subtasks" ("user_id");

-- RLS is intentionally NOT enabled (matches project convention — backend JWT auth enforces user isolation).
-- To roll back: DROP TABLE IF EXISTS "event_subtasks";
