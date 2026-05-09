CREATE TABLE IF NOT EXISTS "Friends" (
  "FriendshipID"  SERIAL PRIMARY KEY,
  "RequesterID"   INTEGER NOT NULL REFERENCES "Users"("UserID") ON DELETE CASCADE,
  "ReceiverID"    INTEGER NOT NULL REFERENCES "Users"("UserID") ON DELETE CASCADE,
  "TrangThai"     TEXT NOT NULL DEFAULT 'pending' CHECK ("TrangThai" IN ('pending', 'accepted', 'rejected')),
  "NgayTao"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "NgayCapNhat"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("RequesterID", "ReceiverID"),
  CHECK ("RequesterID" <> "ReceiverID")
);
CREATE INDEX IF NOT EXISTS idx_friends_requester ON "Friends" ("RequesterID", "TrangThai");
CREATE INDEX IF NOT EXISTS idx_friends_receiver ON "Friends" ("ReceiverID", "TrangThai");
NOTIFY pgrst, 'reload schema';
