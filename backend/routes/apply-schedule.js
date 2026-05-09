/**
 * apply-schedule.js
 * Priority-based bulk apply of schedule items (from Phase 02 OCR output).
 *
 * Routes (mounted at /api/schedule by server.js):
 *   POST /api/schedule/apply                  — insert items, override lower-priority existing
 *   DELETE /api/schedule/batch/:batch_id      — undo an apply batch
 *
 * Priority rank (lower number = higher priority):
 *   1 = ocr_study (Lịch học)  — never overridden by ocr_work
 *   2 = ocr_work  (Lịch làm)
 *   3 = manual / ai           — default for anything else
 */

const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const { supabase } = require("../config/database");

const RANK = { ocr_study: 1, ocr_work: 2, manual: 3, ai: 3 };
const ALLOWED_SOURCES = new Set(["ocr_study", "ocr_work"]);

// Build a human-readable note from OCR metadata fields
function buildNote(item) {
  const parts = [];
  if (item.courseCode) parts.push(`Mã môn: ${item.courseCode}`);
  if (item.campus) parts.push(`Cơ sở: ${item.campus}`);
  if (item.location) parts.push(`Phòng: ${item.location}`);
  if (item.note) parts.push(item.note);
  return parts.length ? parts.join(" | ") : null;
}

function buildInsertRow(item, source, rank, batchId, userId) {
  // Caller may attach task_id to link this session to a parent CongViec
  // (e.g. when grouping multiple sessions of one course into one task).
  const linkedTaskId =
    item.task_id != null && !Number.isNaN(parseInt(item.task_id, 10))
      ? parseInt(item.task_id, 10)
      : null;
  return {
    task_id: linkedTaskId,
    user_id: userId,
    start_at: item.startAt,
    end_at: item.endAt,
    title: item.title,
    note: buildNote(item),
    status: "scheduled",
    is_ai_suggested: false,
    source,
    priority_rank: rank,
    import_batch_id: batchId,
    meta: {
      courseCode: item.courseCode || null,
      campus: item.campus || null,
      location: item.location || null,
      confidence: item.confidence ?? null,
      sourceRow: item.sourceRow || null,
    },
  };
}

// ---------------------------------------------------------------------------
// POST /api/schedule/apply
// Body: { source: 'ocr_study'|'ocr_work', items: [...], dryRun?: boolean }
// ---------------------------------------------------------------------------
router.post("/apply", async (req, res) => {
  try {
    const userId = parseInt(req.userId, 10) || req.userId;
    const { source, items, dryRun } = req.body || {};

    if (!ALLOWED_SOURCES.has(source)) {
      return res.status(400).json({
        success: false,
        message: "source phải là 'ocr_study' hoặc 'ocr_work'",
      });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "items phải là mảng không rỗng",
      });
    }

    const newRank = RANK[source];
    const batchId = crypto.randomUUID();

    const deletesAll = new Set();
    const insertsAll = [];
    const conflicts = [];

    for (const item of items) {
      if (!item || !item.title || !item.startAt || !item.endAt) {
        conflicts.push({ newItem: item, blockedBy: null, reason: "invalid_item" });
        continue;
      }

      // Overlap: existing.start < item.end AND existing.end > item.start (strict)
      const { data: overlaps, error: overlapErr } = await supabase
        .from("task_instances")
        .select("id, start_at, end_at, source, priority_rank, title")
        .eq("user_id", userId)
        .lt("start_at", item.endAt)
        .gt("end_at", item.startAt);

      if (overlapErr) {
        console.error("[apply-schedule] overlap query failed:", overlapErr);
        return res.status(500).json({
          success: false,
          message: "Lỗi truy vấn trùng giờ",
        });
      }

      let shouldInsert = true;
      const toDeleteForThisItem = [];

      for (const ex of overlaps || []) {
        const exRank = ex.priority_rank ?? 3;
        if (newRank < exRank) {
          toDeleteForThisItem.push(ex.id);
        } else {
          // Equal rank OR new is lower priority → existing wins
          shouldInsert = false;
          conflicts.push({
            newItem: {
              title: item.title,
              startAt: item.startAt,
              endAt: item.endAt,
            },
            blockedBy: {
              id: ex.id,
              title: ex.title,
              priority_rank: exRank,
              start_at: ex.start_at,
              end_at: ex.end_at,
            },
          });
          break;
        }
      }

      if (shouldInsert) {
        toDeleteForThisItem.forEach((id) => deletesAll.add(id));
        insertsAll.push(buildInsertRow(item, source, newRank, batchId, userId));
      }
    }

    const summary = {
      batch_id: batchId,
      inserted: insertsAll.length,
      deleted: deletesAll.size,
      skipped: conflicts.length,
      conflicts,
      dryRun: dryRun === true,
    };

    if (dryRun === true) {
      return res.json({ success: true, data: summary });
    }

    // --- Execute: delete first, insert next ---
    if (deletesAll.size > 0) {
      const { error: delErr } = await supabase
        .from("task_instances")
        .delete()
        .in("id", Array.from(deletesAll))
        .eq("user_id", userId);
      if (delErr) {
        console.error("[apply-schedule] delete failed:", delErr);
        return res.status(500).json({
          success: false,
          message: "Xoá công việc cũ thất bại",
          error: delErr.message,
        });
      }
    }

    if (insertsAll.length > 0) {
      const { error: insErr } = await supabase
        .from("task_instances")
        .insert(insertsAll);
      if (insErr) {
        console.error("[apply-schedule] insert failed:", insErr);
        return res.status(500).json({
          success: false,
          message:
            "Đã xoá công việc cũ nhưng thêm công việc mới thất bại. Vui lòng thử lại.",
          error: insErr.message,
          batch_id: batchId,
          partial: { deleted: deletesAll.size, inserted: 0 },
        });
      }
    }

    res.json({ success: true, data: summary });
  } catch (err) {
    console.error("POST /api/schedule/apply error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/schedule/batch/:batch_id
// Undo an entire apply batch (rows with matching import_batch_id).
// ---------------------------------------------------------------------------
router.delete("/batch/:batch_id", async (req, res) => {
  try {
    const userId = parseInt(req.userId, 10) || req.userId;
    const batchId = req.params.batch_id;

    if (!batchId || !/^[0-9a-f-]{36}$/i.test(batchId)) {
      return res.status(400).json({
        success: false,
        message: "batch_id không hợp lệ",
      });
    }

    const { data, error } = await supabase
      .from("task_instances")
      .delete()
      .eq("user_id", userId)
      .eq("import_batch_id", batchId)
      .select("id");

    if (error) {
      console.error("[apply-schedule] undo failed:", error);
      return res.status(500).json({
        success: false,
        message: "Hoàn tác thất bại",
      });
    }

    res.json({
      success: true,
      data: { deleted: (data || []).length, batch_id: batchId },
    });
  } catch (err) {
    console.error("DELETE /api/schedule/batch/:batch_id error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
