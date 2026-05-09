-- =============================================================
-- Migration 009: ChatMessages table for the AI Chat Advisor widget.
-- Idempotent — safe to re-run.
-- =============================================================

CREATE TABLE IF NOT EXISTS "ChatMessages" (
  "Id"              BIGSERIAL PRIMARY KEY,
  "UserID"          INTEGER NOT NULL REFERENCES "Users"("UserID") ON DELETE CASCADE,
  "Role"            TEXT NOT NULL CHECK ("Role" IN ('user', 'assistant')),
  "Content"         TEXT NOT NULL,
  "ContextAttached" JSONB NULL,
  "CreatedAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chatmessages_user_created
  ON "ChatMessages" ("UserID", "CreatedAt" DESC);

-- This app enforces access control in the Node backend (JWT middleware).
-- Match the pattern of all other tables in this project: RLS off.
-- Supabase sometimes auto-enables RLS when tables are created via the UI,
-- which produces "42501 new row violates row-level security policy" on insert.
-- We must: drop any policies, clear FORCE flag, then DISABLE RLS.
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE tablename = 'ChatMessages'
  LOOP
    EXECUTE format('DROP POLICY %I ON "ChatMessages"', p.policyname);
  END LOOP;
END $$;

ALTER TABLE "ChatMessages" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "ChatMessages" DISABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

-- Rollback:
--   DROP TABLE IF EXISTS "ChatMessages";
