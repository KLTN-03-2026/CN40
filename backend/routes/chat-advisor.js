// AI Chat Advisor — floating chat widget backend.
// Endpoints (all under /api/chat-advisor, authenticated):
//   GET    /history             — last 50 messages for current user
//   DELETE /history             — clear all messages for current user
//   GET    /context-snapshot    — current user's tasks/week/salary summary (for "📎 Gửi context")
//   POST   /stream              — SSE: send user msg → stream Gemini reply, persist both sides
//
// Gemini key: GEMINI_API_KEY_CHAT_ADVISOR (fallback GEMINI_API_KEY).

const express = require("express");
const router = express.Router();
const { supabase } = require("../config/database");
const { SYSTEM_PROMPT } = require("../lib/chat-advisor-prompt");

const apiKey =
  (process.env.GEMINI_API_KEY_CHAT_ADVISOR || "").trim() ||
  (process.env.GEMINI_API_KEY || "").trim();

let model = null;
if (apiKey) {
  try {
    const { GoogleGenerativeAI } = require("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(apiKey);
    model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: SYSTEM_PROMPT,
      // 4096 is enough for long advisory replies; avoids mid-sentence cutoff.
      generationConfig: { temperature: 0.7, topP: 0.9, maxOutputTokens: 4096 },
    });
    console.log(
      "[chat-advisor] Gemini ready (" +
        (process.env.GEMINI_API_KEY_CHAT_ADVISOR ? "dedicated" : "shared fallback") +
        ")"
    );
  } catch (err) {
    console.error("[chat-advisor] Gemini init failed:", err.message);
  }
}

const HISTORY_LIMIT = 50;   // rows shown to user
const CONTEXT_WINDOW = 20;  // last N turns sent to Gemini

// ----- Helpers ----------------------------------------------------------

async function fetchHistory(userId, limit) {
  const { data, error } = await supabase
    .from("ChatMessages")
    .select("Id, Role, Content, ContextAttached, CreatedAt")
    .eq("UserID", userId)
    .order("CreatedAt", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).reverse();
}

async function insertMessage(userId, role, content, contextAttached = null) {
  const { data, error } = await supabase
    .from("ChatMessages")
    .insert({ UserID: userId, Role: role, Content: content, ContextAttached: contextAttached })
    .select("Id, CreatedAt")
    .single();
  if (error) throw error;
  return data;
}

function toGeminiHistory(rows) {
  // Gemini expects: [{ role: 'user'|'model', parts: [{text}] }, ...]
  return rows.map((r) => ({
    role: r.Role === "assistant" ? "model" : "user",
    parts: [{ text: r.Content }],
  }));
}

// ----- Routes -----------------------------------------------------------

router.get("/history", async (req, res) => {
  try {
    const userId = req.user?.UserID ?? req.userId;
    const rows = await fetchHistory(userId, HISTORY_LIMIT);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("GET /chat-advisor/history:", err);
    res.status(500).json({ success: false, message: "Lỗi tải lịch sử" });
  }
});

router.delete("/history", async (req, res) => {
  try {
    const userId = req.user?.UserID ?? req.userId;
    await supabase.from("ChatMessages").delete().eq("UserID", userId);
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /chat-advisor/history:", err);
    res.status(500).json({ success: false, message: "Lỗi xoá lịch sử" });
  }
});

// Snapshot of user's state to inject when they tap "📎 Gửi context".
// Kept deliberately small so it doesn't blow the Gemini context window.
router.get("/context-snapshot", async (req, res) => {
  try {
    const userId = req.user?.UserID ?? req.userId;
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);

    const [{ data: activeTasks }, { data: weekEvents }] = await Promise.all([
      supabase
        .from("CongViec")
        .select("TieuDe, MucDoUuTien, ThoiGianUocTinh, LoaiLuong")
        .eq("UserID", userId)
        .neq("TrangThaiThucHien", 2)
        .order("MucDoUuTien", { ascending: false })
        .limit(10),
      supabase
        .from("LichTrinh")
        .select("TieuDe, GioBatDau, GioKetThuc, DaHoanThanh")
        .eq("UserID", userId)
        .gte("GioBatDau", weekAgo.toISOString())
        .lte("GioBatDau", now.toISOString())
        .limit(100),
    ]);

    const total = (weekEvents || []).length;
    const done = (weekEvents || []).filter((e) => e.DaHoanThanh).length;

    res.json({
      success: true,
      data: {
        activeTasks: activeTasks || [],
        weekStats: { total, done, completionRate: total ? Math.round((done / total) * 100) : 0 },
      },
    });
  } catch (err) {
    console.error("GET /context-snapshot:", err);
    res.status(500).json({ success: false, message: "Lỗi tải context" });
  }
});

// Streaming chat endpoint — Server-Sent Events.
// Request: { message: string, attachContext?: object }
// Events: `data: {"chunk":"..."}` for each chunk, then `data: {"done":true,"messageId":N}`.
router.post("/stream", async (req, res) => {
  const userId = req.user?.UserID ?? req.userId;
  const { message, attachContext } = req.body || {};

  if (!model) {
    return res.status(503).json({ success: false, message: "Chat Advisor chưa cấu hình API key." });
  }
  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ success: false, message: "Thiếu nội dung tin nhắn." });
  }

  // SSE headers — flush immediately so the client sees the stream open.
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    // Persist user message first so refresh-during-stream still keeps it.
    const userMsg = String(message).slice(0, 4000);
    await insertMessage(userId, "user", userMsg, attachContext || null);

    // Compose context block (one-shot) if user attached a snapshot.
    const contextBlock = attachContext
      ? `\n\n[CONTEXT ĐÍNH KÈM — dữ liệu thật của user]\n${JSON.stringify(attachContext).slice(0, 3000)}`
      : "";

    const prior = await fetchHistory(userId, CONTEXT_WINDOW);
    // Drop the message we just inserted so it becomes the `sendMessageStream` arg.
    const history = toGeminiHistory(prior.slice(0, -1));

    const chat = model.startChat({ history });
    const result = await chat.sendMessageStream(userMsg + contextBlock);

    let full = "";
    let streamErr = null;
    try {
      for await (const chunk of result.stream) {
        const text = chunk.text?.() || "";
        if (text) {
          full += text;
          send({ chunk: text });
        }
      }
    } catch (e) {
      streamErr = e;
    }

    // Surface finishReason when Gemini stops early (MAX_TOKENS, SAFETY, etc.)
    let finishReason = null;
    try {
      const agg = await result.response;
      finishReason = agg?.candidates?.[0]?.finishReason || null;
    } catch {
      /* ignore — already have full from chunks */
    }

    // Always persist whatever text we managed to stream (no silent loss).
    const persisted = full.trim()
      ? await insertMessage(userId, "assistant", full)
      : null;

    if (streamErr) {
      console.error("[chat-advisor] stream aborted:", streamErr.message, "finishReason:", finishReason);
      send({
        error:
          finishReason === "SAFETY"
            ? "Gemini chặn nội dung vì lý do an toàn. Thử hỏi lại bằng cách khác."
            : finishReason === "RECITATION"
            ? "Gemini chặn vì phản hồi trích dẫn nội dung bản quyền."
            : `Stream bị ngắt: ${streamErr.message}`,
        messageId: persisted?.Id ?? null,
      });
    } else if (finishReason === "MAX_TOKENS") {
      send({
        error: "Phản hồi bị cắt vì vượt giới hạn độ dài. Hỏi lại ngắn gọn hơn hoặc chia nhỏ câu hỏi.",
        messageId: persisted?.Id ?? null,
      });
    } else {
      send({ done: true, messageId: persisted?.Id ?? null });
    }
    res.end();
  } catch (err) {
    console.error("POST /chat-advisor/stream:", err);
    send({ error: err.message || "Lỗi stream" });
    res.end();
  }
});

module.exports = router;
