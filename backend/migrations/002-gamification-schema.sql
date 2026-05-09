-- 002-gamification-schema.sql
-- UserGamification: stores cached XP/level/streak/badges per user

CREATE TABLE IF NOT EXISTS "UserGamification" (
  "UserID" int PRIMARY KEY REFERENCES "Users"("UserID") ON DELETE CASCADE,
  "XP" int DEFAULT 0,
  "Level" int DEFAULT 1,
  "Streak" int DEFAULT 0,
  "Badges" jsonb DEFAULT '[]',
  "LastXPUpdate" timestamptz DEFAULT now(),
  "CreatedAt" timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gamification_xp ON "UserGamification" ("XP" DESC);
