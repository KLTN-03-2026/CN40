-- Migration 011: Google Calendar OAuth connections + GoogleEventId on LichTrinh
-- Direction: UP only (irreversible — uses IF NOT EXISTS guards)

CREATE TABLE IF NOT EXISTS "GoogleCalendarConnections" (
  "UserID"              INTEGER PRIMARY KEY REFERENCES "Users"("UserID") ON DELETE CASCADE,
  "GoogleEmail"         TEXT NOT NULL,
  "RefreshToken"        TEXT NOT NULL,
  "CalendarId"          TEXT DEFAULT 'primary',
  "TrangThaiKetNoi"     BOOLEAN NOT NULL DEFAULT TRUE,
  "NgayKetNoi"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "NgayCapNhat"         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE "LichTrinh"
  ADD COLUMN IF NOT EXISTS "GoogleEventId" TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_lichTrinh_google_event
  ON "LichTrinh" ("GoogleEventId") WHERE "GoogleEventId" IS NOT NULL;

NOTIFY pgrst, 'reload schema';
