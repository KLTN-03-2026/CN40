// ============================================================
// Vietnamese name matcher for work-schedule filtering.
// Given a list of items (each with `assignees: string[]`) and
// the current user's HoTen, return items where at least one
// assignee matches the user's name.
//
// Matching strategy (Vietnamese):
// 1. NFD-normalize + strip combining marks → accent-insensitive.
// 2. Lowercase + collapse whitespace.
// 3. Prioritize LAST TOKEN match (Vietnamese "tên gọi" = given name,
//    comes last: "Trần Quang Quốc" → "quốc").
// 4. Fall back to full-string contains for safety.
// 5. Ambiguity guard: if user name is a single short token and the
//    assignee has another word after the match ("Quốc Anh"), treat
//    as different person — UNLESS the user's HoTen is multi-token
//    and matches fully.
//
// Phase 04 may extend this; stub is already usable for smoke tests.
// ============================================================

function normalize(str) {
  if (!str) return "";
  return String(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritics
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(str) {
  const n = normalize(str);
  return n ? n.split(" ").filter(Boolean) : [];
}

/**
 * Returns true if assignee name matches user name under Vietnamese rules.
 */
function isSamePerson(assignee, userName) {
  const a = tokens(assignee);
  const u = tokens(userName);
  if (!a.length || !u.length) return false;

  // 1. Exact full-token match
  const aJoined = a.join(" ");
  const uJoined = u.join(" ");
  if (aJoined === uJoined) return true;

  // 2. User name (e.g. "Quang Quốc") appears as contiguous suffix of assignee
  //    Example: assignee "Trần Quang Quốc" ⊃ user "Quang Quốc" → match.
  const uLen = u.length;
  if (uLen >= 2 && a.length >= uLen) {
    const tail = a.slice(a.length - uLen).join(" ");
    if (tail === uJoined) return true;
  }

  // 3. Single-token user name ("Quốc") matches only if assignee's LAST token is identical.
  //    Protects against "Quốc" vs "Quốc Anh" false positive.
  if (uLen === 1) {
    return a[a.length - 1] === u[0];
  }

  // 4. User name tokens all appear (as a subset, order-preserving) in assignee.
  let i = 0;
  for (const t of a) {
    if (t === u[i]) i++;
    if (i === u.length) break;
  }
  return i === u.length;
}

/**
 * Filter items by user name. Returns { matched, unmatchedAssignees }.
 * @param {Array<{assignees?: string[]}>} items
 * @param {string} userName
 */
function matchUserNameInItems(items, userName) {
  if (!Array.isArray(items)) return { matched: [], unmatchedAssignees: [] };
  if (!userName) return { matched: [], unmatchedAssignees: [] };

  const matched = [];
  const unmatchedSet = new Set();

  for (const item of items) {
    const assignees = Array.isArray(item.assignees) ? item.assignees : [];
    const hit = assignees.some((a) => isSamePerson(a, userName));
    if (hit) {
      matched.push(item);
    } else {
      assignees.forEach((a) => unmatchedSet.add(a));
    }
  }

  return {
    matched,
    unmatchedAssignees: Array.from(unmatchedSet),
  };
}

module.exports = {
  matchUserNameInItems,
  isSamePerson,
  normalize,
  tokens, // exported for unit tests
};
