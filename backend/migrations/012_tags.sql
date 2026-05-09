CREATE TABLE IF NOT EXISTS "Tags" (
  "TagID"     SERIAL PRIMARY KEY,
  "UserID"    INTEGER NOT NULL REFERENCES "Users"("UserID") ON DELETE CASCADE,
  "TenTag"    TEXT NOT NULL,
  "MauSac"    TEXT NOT NULL DEFAULT '#3B82F6',
  "NgayTao"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("UserID", "TenTag")
);
CREATE TABLE IF NOT EXISTS "TaskTags" (
  "MaCongViec"  INTEGER NOT NULL REFERENCES "CongViec"("MaCongViec") ON DELETE CASCADE,
  "TagID"       INTEGER NOT NULL REFERENCES "Tags"("TagID") ON DELETE CASCADE,
  PRIMARY KEY ("MaCongViec", "TagID")
);
CREATE INDEX IF NOT EXISTS idx_tags_user ON "Tags" ("UserID");
CREATE INDEX IF NOT EXISTS idx_tasktags_task ON "TaskTags" ("MaCongViec");
CREATE INDEX IF NOT EXISTS idx_tasktags_tag ON "TaskTags" ("TagID");
NOTIFY pgrst, 'reload schema';
