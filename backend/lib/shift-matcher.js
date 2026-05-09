/**
 * shift-matcher.js
 * Pure helper — given a start_at timestamp and a task's CauHinhCa array,
 * return the name of the shift whose window contains that time (±30 min
 * grace). Supports overnight shifts (end < start means crosses midnight).
 *
 * Tie-break: nearest shift.start to the instance's start time.
 *
 * Exports: matchShift(startAtIso, cauHinhCa) -> string|null
 */

const TZ_OFFSET_MINUTES = 7 * 60; // Asia/Bangkok (UTC+7, no DST)
const GRACE_MINUTES = 30;

function toLocalMinutes(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const utcMins = d.getUTCHours() * 60 + d.getUTCMinutes();
  return (((utcMins + TZ_OFFSET_MINUTES) % 1440) + 1440) % 1440;
}

function parseHM(hm) {
  if (typeof hm !== "string") return null;
  const m = hm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

// Minute-circular interval: [a, b] inclusive, wrapping at 1440.
function inInterval(x, a, b) {
  if (a <= b) return x >= a && x <= b;
  return x >= a || x <= b;
}

function wrap(m) {
  return ((m % 1440) + 1440) % 1440;
}

/**
 * Find the shift that best matches a start_at moment.
 * @param {string} startAtIso - ISO timestamp
 * @param {Array<{name:string,start:string,end:string}>} cauHinhCa
 * @returns {string|null} — name of matching shift, or null.
 */
function matchShift(startAtIso, cauHinhCa) {
  if (!Array.isArray(cauHinhCa) || cauHinhCa.length === 0) return null;
  const localMin = toLocalMinutes(startAtIso);
  if (localMin == null) return null;

  const candidates = [];
  for (const s of cauHinhCa) {
    if (!s?.name) continue;
    const start = parseHM(s.start);
    const end = parseHM(s.end);
    if (start == null || end == null) continue;
    const a = wrap(start - GRACE_MINUTES);
    const b = wrap(end + GRACE_MINUTES);
    if (inInterval(localMin, a, b)) {
      candidates.push({ name: s.name, start, end });
    }
  }

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].name;

  // Tie-break: choose shift whose start is closest (circular distance).
  let best = candidates[0];
  let bestDiff = Math.min(
    Math.abs(best.start - localMin),
    1440 - Math.abs(best.start - localMin)
  );
  for (const c of candidates.slice(1)) {
    const diff = Math.min(
      Math.abs(c.start - localMin),
      1440 - Math.abs(c.start - localMin)
    );
    if (diff < bestDiff) {
      best = c;
      bestDiff = diff;
    }
  }
  return best.name;
}

module.exports = { matchShift, toLocalMinutes, parseHM };
