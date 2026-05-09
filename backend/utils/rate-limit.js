// ============================================================
// Simple in-memory per-user rate limiter.
// Used by schedule-image parse endpoint: 10 calls / hour / user.
// KISS: no Redis; resets when the process restarts (acceptable
// for abuse-prevention only, not for strict quota).
// ============================================================

const WINDOW_MS = 60 * 60 * 1000; // 1 hour

// Map<userId, number[]>  — array of request timestamps (ms)
const hits = new Map();

/**
 * Returns { allowed, remaining, resetInMs }.
 * Prunes expired timestamps on every call so memory stays bounded.
 *
 * @param {string|number} userId
 * @param {number} max  default 10
 */
function checkRateLimit(userId, max = 10) {
  const now = Date.now();
  const key = String(userId);
  const list = hits.get(key) || [];

  // drop timestamps outside the sliding window
  const fresh = list.filter((ts) => now - ts < WINDOW_MS);

  if (fresh.length >= max) {
    const oldest = fresh[0];
    return {
      allowed: false,
      remaining: 0,
      resetInMs: WINDOW_MS - (now - oldest),
    };
  }

  fresh.push(now);
  hits.set(key, fresh);
  return {
    allowed: true,
    remaining: max - fresh.length,
    resetInMs: WINDOW_MS,
  };
}

module.exports = { checkRateLimit };
