CREATE TABLE IF NOT EXISTS "CalendarShares" (
  "ShareID"       SERIAL PRIMARY KEY,
  "OwnerID"       INTEGER NOT NULL REFERENCES "Users"("UserID") ON DELETE CASCADE,
  "SharedWithID"  INTEGER NOT NULL REFERENCES "Users"("UserID") ON DELETE CASCADE,
  "Permission"    TEXT NOT NULL DEFAULT 'viewer' CHECK ("Permission" IN ('viewer', 'editor')),
  "TrangThai"     TEXT NOT NULL DEFAULT 'pending' CHECK ("TrangThai" IN ('pending', 'accepted', 'rejected')),
  "NgayTao"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "NgayCapNhat"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("OwnerID", "SharedWithID")
);
CREATE INDEX IF NOT EXISTS idx_shares_owner ON "CalendarShares" ("OwnerID");
CREATE INDEX IF NOT EXISTS idx_shares_shared ON "CalendarShares" ("SharedWithID", "TrangThai");
NOTIFY pgrst, 'reload schema';
