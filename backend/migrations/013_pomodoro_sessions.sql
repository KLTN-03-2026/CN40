CREATE TABLE IF NOT EXISTS "PomodoroSessions" (
  "SessionID"       SERIAL PRIMARY KEY,
  "UserID"          INTEGER NOT NULL REFERENCES "Users"("UserID") ON DELETE CASCADE,
  "MaCongViec"      INTEGER REFERENCES "CongViec"("MaCongViec") ON DELETE SET NULL,
  "BatDau"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "ThoiLuongPhut"   SMALLINT NOT NULL DEFAULT 25,
  "DaHoanThanh"     BOOLEAN NOT NULL DEFAULT FALSE,
  "LoaiPhien"       TEXT NOT NULL DEFAULT 'focus'
                    CHECK ("LoaiPhien" IN ('focus', 'short_break', 'long_break'))
);
CREATE INDEX IF NOT EXISTS idx_pomodoro_user ON "PomodoroSessions" ("UserID", "BatDau" DESC);
CREATE INDEX IF NOT EXISTS idx_pomodoro_task ON "PomodoroSessions" ("MaCongViec") WHERE "MaCongViec" IS NOT NULL;
NOTIFY pgrst, 'reload schema';
