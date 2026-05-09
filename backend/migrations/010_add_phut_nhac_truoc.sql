-- =============================================================
-- Migration 010: Add PhutNhacTruoc to TelegramConnections
-- Lets each user customise how many minutes before a task to ping.
-- Idempotent — safe to re-run.
-- =============================================================

ALTER TABLE "TelegramConnections"
  ADD COLUMN IF NOT EXISTS "PhutNhacTruoc" SMALLINT NOT NULL DEFAULT 15;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'telegramconnections_phutnhactruoc_chk'
  ) THEN
    ALTER TABLE "TelegramConnections"
      ADD CONSTRAINT telegramconnections_phutnhactruoc_chk
      CHECK ("PhutNhacTruoc" BETWEEN 1 AND 180);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- Rollback:
--   ALTER TABLE "TelegramConnections" DROP COLUMN IF EXISTS "PhutNhacTruoc";
