-- =============================================================
-- Migration 008: TelegramConnections + extended notification prefs
-- Run in Supabase SQL Editor.
-- Idempotent — safe to re-run.
-- =============================================================

CREATE TABLE IF NOT EXISTS "TelegramConnections" (
  "UserID"            INTEGER PRIMARY KEY REFERENCES "Users"("UserID") ON DELETE CASCADE,
  "TelegramChatId"    TEXT NOT NULL UNIQUE,
  "TelegramUsername"  TEXT NULL,
  "TelegramFirstName" TEXT NULL,
  "TrangThaiKetNoi"   BOOLEAN NOT NULL DEFAULT TRUE,

  -- Original pref set (already used by bot.js today)
  "ThongBaoNhiemVu"   BOOLEAN NOT NULL DEFAULT TRUE,
  "ThongBaoSuKien"    BOOLEAN NOT NULL DEFAULT TRUE,
  "ThongBaoGoiY"      BOOLEAN NOT NULL DEFAULT TRUE,

  -- Per-user scheduled times (HH:MM, VN timezone)
  "GioLichNgay"       TEXT NOT NULL DEFAULT '08:00',
  "GioNhacNhiemVu"    TEXT NOT NULL DEFAULT '14:00',
  "GioTongKetNgay"    TEXT NOT NULL DEFAULT '18:00',

  -- New pref set (this feature)
  "ThongBao15Phut"    BOOLEAN NOT NULL DEFAULT TRUE,   -- 15 min before each task
  "ThongBaoHangNgay"  BOOLEAN NOT NULL DEFAULT TRUE,   -- Daily digest at GioLichNgay
  "ThongBaoTuan"      BOOLEAN NOT NULL DEFAULT TRUE,   -- Weekly stats (Sunday evening)
  "ThongBaoCuoiTuan"  BOOLEAN NOT NULL DEFAULT TRUE,   -- Weekend AI suggestions
  "ThongBaoLuong"     BOOLEAN NOT NULL DEFAULT FALSE,  -- Monthly salary breakdown
  "NgayNhanLuong"     SMALLINT NOT NULL DEFAULT 1
                      CHECK ("NgayNhanLuong" BETWEEN 1 AND 28),

  "NgayKetNoi"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "NgayCapNhat"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Existing DBs may already have the core columns — add the new ones safely.
ALTER TABLE "TelegramConnections"
  ADD COLUMN IF NOT EXISTS "ThongBao15Phut"   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "ThongBaoHangNgay" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "ThongBaoTuan"     BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "ThongBaoCuoiTuan" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "ThongBaoLuong"    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "NgayNhanLuong"    SMALLINT NOT NULL DEFAULT 1;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'telegramconnections_ngaynhanluong_chk'
  ) THEN
    ALTER TABLE "TelegramConnections"
      ADD CONSTRAINT telegramconnections_ngaynhanluong_chk
      CHECK ("NgayNhanLuong" BETWEEN 1 AND 28);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_telegram_chatid
  ON "TelegramConnections" ("TelegramChatId");

-- Log table: which tasks have already been reminded 15 min before,
-- so the cron doesn't double-send if it fires multiple times.
CREATE TABLE IF NOT EXISTS "TelegramReminderLog" (
  "Id"        BIGSERIAL PRIMARY KEY,
  "UserID"    INTEGER NOT NULL REFERENCES "Users"("UserID") ON DELETE CASCADE,
  "TaskID"    INTEGER NOT NULL,
  "Kind"      TEXT NOT NULL,            -- '15min' | 'daily' | 'weekly' | 'salary' | 'weekend'
  "SentAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("UserID", "TaskID", "Kind", "SentAt")
);

CREATE INDEX IF NOT EXISTS idx_reminderlog_user_kind
  ON "TelegramReminderLog" ("UserID", "Kind", "SentAt" DESC);

-- Reload PostgREST schema cache so new columns show up immediately.
NOTIFY pgrst, 'reload schema';

-- Rollback:
--   DROP TABLE IF EXISTS "TelegramReminderLog";
--   DROP TABLE IF EXISTS "TelegramConnections";
