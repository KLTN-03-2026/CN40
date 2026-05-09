CREATE TABLE IF NOT EXISTS "Habits" (
  "HabitID"       SERIAL PRIMARY KEY,
  "UserID"        INTEGER NOT NULL REFERENCES "Users"("UserID") ON DELETE CASCADE,
  "TenThoiQuen"   TEXT NOT NULL,
  "BieuTuong"     TEXT DEFAULT '📌',
  "TanSuat"       TEXT NOT NULL DEFAULT 'daily' CHECK ("TanSuat" IN ('daily', 'weekly')),
  "MucTieu"       SMALLINT NOT NULL DEFAULT 1,
  "Streak"        INTEGER NOT NULL DEFAULT 0,
  "DangHoatDong"  BOOLEAN NOT NULL DEFAULT TRUE,
  "NgayTao"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS "HabitLogs" (
  "LogID"         SERIAL PRIMARY KEY,
  "HabitID"       INTEGER NOT NULL REFERENCES "Habits"("HabitID") ON DELETE CASCADE,
  "NgayHoanThanh" DATE NOT NULL,
  "DaHoanThanh"   BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE ("HabitID", "NgayHoanThanh")
);
CREATE INDEX IF NOT EXISTS idx_habits_user ON "Habits" ("UserID");
CREATE INDEX IF NOT EXISTS idx_habitlogs_habit ON "HabitLogs" ("HabitID", "NgayHoanThanh" DESC);
NOTIFY pgrst, 'reload schema';
