/**
 * tags.js
 * CRUD for user Tags + TaskTags many-to-many.
 * Mounted at /api/tags (auth already applied by server.js).
 */

const express = require("express");
const router = express.Router();
const { supabase } = require("../config/database");
require("dotenv").config();

// Shared Gemini key (same pattern as ai-reference.js)
const apiKey =
  (process.env.GEMINI_API_KEY || "").trim();

let geminiModel = null;
if (apiKey) {
  try {
    const { GoogleGenerativeAI } = require("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(apiKey);
    geminiModel = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: { temperature: 0.5, maxOutputTokens: 256 },
    });
  } catch (e) {
    console.error("[tags] Gemini init failed:", e.message);
  }
}

const PRESET_COLORS = [
  "#DC2626", "#F59E0B", "#10B981", "#3B82F6",
  "#8B5CF6", "#EC4899", "#6366F1", "#14B8A6",
];

function isValidColor(c) {
  return typeof c === "string" && /^#[0-9A-Fa-f]{6}$/.test(c);
}

// GET /api/tags?search=
router.get("/", async (req, res) => {
  try {
    const userId = req.userId;
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";

    let query = supabase
      .from("Tags")
      .select("TagID, TenTag, MauSac")
      .eq("UserID", userId)
      .order("TenTag", { ascending: true });

    if (search) {
      query = query.ilike("TenTag", `%${search}%`);
    }

    const { data, error } = await query;
    if (error) {
      console.error("[tags] GET /:", error);
      return res.status(500).json({ success: false, message: "Lỗi server" });
    }
    res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error("[tags] GET / exception:", err);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

// POST /api/tags — create tag
router.post("/", async (req, res) => {
  try {
    const userId = req.userId;
    const { name, color } = req.body || {};

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ success: false, message: "Tên tag là bắt buộc" });
    }
    const tenTag = name.trim().slice(0, 30);
    const mauSac = isValidColor(color) ? color : "#3B82F6";

    const { data, error } = await supabase
      .from("Tags")
      .insert({ UserID: userId, TenTag: tenTag, MauSac: mauSac })
      .select("TagID, TenTag, MauSac")
      .single();

    if (error) {
      if (error.code === "23505") {
        return res.status(409).json({ success: false, message: "Tag đã tồn tại" });
      }
      console.error("[tags] POST /:", error);
      return res.status(500).json({ success: false, message: "Lỗi server" });
    }
    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error("[tags] POST / exception:", err);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

// PUT /api/tags/:id — update tag name/color
router.put("/:id", async (req, res) => {
  try {
    const userId = req.userId;
    const tagId = parseInt(req.params.id, 10);
    if (isNaN(tagId)) {
      return res.status(400).json({ success: false, message: "ID không hợp lệ" });
    }

    const { name, color } = req.body || {};
    const updates = {};
    if (name && typeof name === "string" && name.trim()) {
      updates.TenTag = name.trim().slice(0, 30);
    }
    if (color !== undefined) {
      if (!isValidColor(color)) {
        return res.status(400).json({ success: false, message: "Màu sắc không hợp lệ (phải là #RRGGBB)" });
      }
      updates.MauSac = color;
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: "Không có dữ liệu để cập nhật" });
    }

    const { data, error } = await supabase
      .from("Tags")
      .update(updates)
      .eq("TagID", tagId)
      .eq("UserID", userId)
      .select("TagID, TenTag, MauSac")
      .maybeSingle();

    if (error) {
      if (error.code === "23505") {
        return res.status(409).json({ success: false, message: "Tên tag đã tồn tại" });
      }
      console.error("[tags] PUT /:id:", error);
      return res.status(500).json({ success: false, message: "Lỗi server" });
    }
    if (!data) {
      return res.status(404).json({ success: false, message: "Không tìm thấy tag" });
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error("[tags] PUT /:id exception:", err);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

// DELETE /api/tags/:id — cascades TaskTags via FK
router.delete("/:id", async (req, res) => {
  try {
    const userId = req.userId;
    const tagId = parseInt(req.params.id, 10);
    if (isNaN(tagId)) {
      return res.status(400).json({ success: false, message: "ID không hợp lệ" });
    }

    // Verify ownership before delete
    const { data: existing } = await supabase
      .from("Tags")
      .select("TagID")
      .eq("TagID", tagId)
      .eq("UserID", userId)
      .maybeSingle();

    if (!existing) {
      return res.status(404).json({ success: false, message: "Không tìm thấy tag" });
    }

    const { error } = await supabase
      .from("Tags")
      .delete()
      .eq("TagID", tagId)
      .eq("UserID", userId);

    if (error) {
      console.error("[tags] DELETE /:id:", error);
      return res.status(500).json({ success: false, message: "Lỗi server" });
    }
    res.json({ success: true, message: "Xóa tag thành công" });
  } catch (err) {
    console.error("[tags] DELETE /:id exception:", err);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

// POST /api/tags/suggest — AI suggest tags for a task title
router.post("/suggest", async (req, res) => {
  try {
    const { title } = req.body || {};
    if (!title || typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ success: false, message: "Thiếu title" });
    }
    if (!geminiModel) {
      return res.status(503).json({ success: false, message: "AI chưa được cấu hình" });
    }

    const prompt = `Suggest 2-3 short, concise tags (labels) for a task titled: "${title.trim().slice(0, 200)}".
Return ONLY a JSON array of tag name strings, no explanation. Example: ["urgent", "design", "review"]`;

    let suggestions = [];
    try {
      const result = await geminiModel.generateContent(prompt);
      const text = (await result.response).text();
      // Extract JSON array from response
      const match = text.match(/\[[\s\S]*?\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) {
          suggestions = parsed
            .filter((s) => typeof s === "string" && s.trim())
            .map((s) => s.trim().slice(0, 30))
            .slice(0, 3);
        }
      }
    } catch (e) {
      console.error("[tags] Gemini suggest:", e.message);
      return res.status(502).json({ success: false, message: "AI không phản hồi" });
    }

    res.json({ success: true, data: suggestions });
  } catch (err) {
    console.error("[tags] POST /suggest exception:", err);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

module.exports = router;
module.exports.__PRESET_COLORS = PRESET_COLORS;
