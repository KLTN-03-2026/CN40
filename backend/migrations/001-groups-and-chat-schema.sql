-- =============================================
-- Phase 1: Groups & Chat Schema
-- Run in Supabase SQL Editor
-- =============================================

-- GROUPS
CREATE TABLE IF NOT EXISTS "Groups" (
  "GroupID" serial PRIMARY KEY,
  "TenNhom" varchar(100) NOT NULL,
  "MoTa" text,
  "AvatarUrl" text,
  "OwnerID" int NOT NULL REFERENCES "Users"("UserID") ON DELETE CASCADE,
  "MaxMembers" int DEFAULT 20,
  "NgayTao" timestamptz DEFAULT now(),
  "NgayCapNhat" timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "GroupMembers" (
  "MemberID" serial PRIMARY KEY,
  "GroupID" int NOT NULL REFERENCES "Groups"("GroupID") ON DELETE CASCADE,
  "UserID" int NOT NULL REFERENCES "Users"("UserID") ON DELETE CASCADE,
  "VaiTro" varchar(20) DEFAULT 'member',
  "NgayThamGia" timestamptz DEFAULT now(),
  UNIQUE ("GroupID", "UserID")
);

CREATE TABLE IF NOT EXISTS "GroupTasks" (
  "GroupTaskID" serial PRIMARY KEY,
  "GroupID" int NOT NULL REFERENCES "Groups"("GroupID") ON DELETE CASCADE,
  "AssignedTo" int NOT NULL REFERENCES "Users"("UserID"),
  "AssignedBy" int NOT NULL REFERENCES "Users"("UserID"),
  "TieuDe" varchar(200) NOT NULL,
  "MoTa" text,
  "TrangThai" varchar(20) DEFAULT 'pending',
  "MucDoUuTien" int DEFAULT 2,
  "HanChot" timestamptz,
  "NgayTao" timestamptz DEFAULT now(),
  "NgayCapNhat" timestamptz DEFAULT now()
);

-- CHAT / MESSAGING
CREATE TABLE IF NOT EXISTS "Conversations" (
  "ConversationID" serial PRIMARY KEY,
  "LoaiHoiThoai" varchar(10) NOT NULL CHECK ("LoaiHoiThoai" IN ('direct', 'group')),
  "GroupID" int REFERENCES "Groups"("GroupID") ON DELETE CASCADE,
  "NgayTao" timestamptz DEFAULT now(),
  "TinNhanCuoi" text,
  "ThoiGianCuoi" timestamptz
);

CREATE TABLE IF NOT EXISTS "ConversationMembers" (
  "ID" serial PRIMARY KEY,
  "ConversationID" int NOT NULL REFERENCES "Conversations"("ConversationID") ON DELETE CASCADE,
  "UserID" int NOT NULL REFERENCES "Users"("UserID") ON DELETE CASCADE,
  "DaDoc" boolean DEFAULT false,
  "NgayThamGia" timestamptz DEFAULT now(),
  UNIQUE ("ConversationID", "UserID")
);

CREATE TABLE IF NOT EXISTS "Messages" (
  "MessageID" serial PRIMARY KEY,
  "ConversationID" int NOT NULL REFERENCES "Conversations"("ConversationID") ON DELETE CASCADE,
  "SenderID" int NOT NULL REFERENCES "Users"("UserID"),
  "NoiDung" text NOT NULL,
  "LoaiTinNhan" varchar(20) DEFAULT 'text',
  "MetaData" jsonb,
  "NgayGui" timestamptz DEFAULT now(),
  "DaXoa" boolean DEFAULT false
);

-- INDEXES for performance
CREATE INDEX IF NOT EXISTS idx_group_members_group ON "GroupMembers"("GroupID");
CREATE INDEX IF NOT EXISTS idx_group_members_user ON "GroupMembers"("UserID");
CREATE INDEX IF NOT EXISTS idx_group_tasks_group ON "GroupTasks"("GroupID");
CREATE INDEX IF NOT EXISTS idx_group_tasks_assigned ON "GroupTasks"("AssignedTo");
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON "Messages"("ConversationID", "NgayGui" DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_members_user ON "ConversationMembers"("UserID");
CREATE INDEX IF NOT EXISTS idx_conversations_group ON "Conversations"("GroupID");

-- Enable Realtime on Messages table for live chat
ALTER PUBLICATION supabase_realtime ADD TABLE "Messages";
