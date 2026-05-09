/**
 * Generic task sorter.
 *
 * Criteria:
 *  - "category" | "priority" | "duration"
 * Direction:
 *  - "asc" | "desc"
 *
 * Defaults when unsorted (criterion=null): return input as-is.
 *
 * Nullable values are pushed to the END regardless of direction.
 *
 * Fields are resolved via a shape hint so the same sorter works with
 * Vietnamese DB shape (MucDoUuTien/TenLoai/ThoiGianUocTinh) and the
 * English AI-modal shape (priority/category/estimatedMinutes).
 */
(function () {
  "use strict";
  if (window.TaskSorter) return;

  // Field accessors per known shape. Extend here if a new view needs it.
  const SHAPES = {
    cv: {
      category: (t) => t?.TenLoai ?? t?.LoaiCongViec?.TenLoai ?? null,
      priority: (t) => toInt(t?.MucDoUuTien),
      duration: (t) => toInt(t?.ThoiGianUocTinh),
    },
    ai: {
      category: (t) => t?.category ?? t?.Tag ?? null,
      priority: (t) => toInt(t?.priority),
      duration: (t) => toInt(t?.estimatedMinutes),
    },
  };

  function toInt(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function getAccessor(shape, criterion) {
    const s = SHAPES[shape] || SHAPES.cv;
    return s[criterion];
  }

  /**
   * Compare two values. Nulls are ALWAYS larger (pushed to end).
   * direction: "asc" | "desc" flips only non-null comparisons.
   */
  function compareValues(a, b, direction) {
    const aNull = a === null || a === undefined;
    const bNull = b === null || b === undefined;
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;

    let cmp;
    if (typeof a === "number" && typeof b === "number") {
      cmp = a - b;
    } else {
      cmp = String(a).localeCompare(String(b), "vi", { sensitivity: "base" });
    }
    return direction === "desc" ? -cmp : cmp;
  }

  /**
   * Sort tasks by a single criterion. Pure — returns a new array.
   * If criterion is falsy, returns a shallow copy unchanged (preserves input order).
   */
  function sortTasks(items, criterion, direction, shape) {
    if (!Array.isArray(items)) return [];
    const copy = items.slice();
    if (!criterion) return copy;

    const accessor = getAccessor(shape || "cv", criterion);
    if (typeof accessor !== "function") return copy;

    const dir = direction === "desc" ? "desc" : "asc";
    // Decorate-sort-undecorate: stable + avoids recomputing accessor.
    return copy
      .map((item, idx) => ({ item, idx, key: accessor(item) }))
      .sort((a, b) => {
        const c = compareValues(a.key, b.key, dir);
        return c !== 0 ? c : a.idx - b.idx;
      })
      .map((w) => w.item);
  }

  window.TaskSorter = {
    sortTasks,
    // exposed for tests / advanced use
    _compareValues: compareValues,
    _shapes: SHAPES,
  };
})();
