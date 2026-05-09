/**
 * google-calendar.js
 * Express router for /api/google-calendar — OAuth flow + sync endpoints.
 * /callback intentionally has NO auth middleware (uses signed JWT state param).
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { authenticateToken } = require('../middleware/auth');
const { supabase } = require('../config/database');
const {
  isConfigured,
  getAuthUrl,
  handleCallback,
} = require('../lib/google-calendar-client');
const { syncWeek } = require('../lib/google-calendar-sync');

/** Guard: respond 501 when OAuth env vars are absent. */
function requireConfig(req, res, next) {
  if (!isConfigured()) {
    return res.status(501).json({
      success: false,
      message: 'Google Calendar chưa được cấu hình trên server',
    });
  }
  next();
}

// ── GET /api/google-calendar/auth-url ────────────────────────────────────────
// Returns the Google OAuth consent URL for the authenticated user.
router.get('/auth-url', authenticateToken, requireConfig, (req, res) => {
  try {
    const url = getAuthUrl(req.userId);
    res.json({ success: true, url });
  } catch (err) {
    console.error('auth-url error:', err.message);
    res.status(500).json({ success: false, message: 'Không thể tạo URL xác thực' });
  }
});

// ── GET /api/google-calendar/callback ────────────────────────────────────────
// Receives Google's OAuth redirect. Verifies signed state, exchanges code.
// No authenticateToken — userId comes from the JWT state param.
router.get('/callback', requireConfig, async (req, res) => {
  const { code, state, error: oauthError } = req.query;

  if (oauthError) {
    console.warn('Google OAuth denied:', oauthError);
    return res.redirect('/index.html#connections?gc_error=access_denied');
  }

  if (!code || !state) {
    return res.status(400).json({ success: false, message: 'Thiếu code hoặc state' });
  }

  let userId;
  try {
    const payload = jwt.verify(state, process.env.JWT_SECRET);
    userId = payload.userId;
  } catch (err) {
    return res.status(400).json({ success: false, message: 'State không hợp lệ hoặc đã hết hạn' });
  }

  try {
    await handleCallback(code, userId);
    res.redirect('/index.html#connections?gc_connected=1');
  } catch (err) {
    console.error('Google callback error:', err.message);
    res.redirect(`/index.html#connections?gc_error=${encodeURIComponent(err.message)}`);
  }
});

// ── GET /api/google-calendar/status ──────────────────────────────────────────
// Returns connection status and linked Google email for the current user.
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('GoogleCalendarConnections')
      .select('GoogleEmail, TrangThaiKetNoi, NgayKetNoi, NgayCapNhat')
      .eq('UserID', req.userId)
      .single();

    if (error || !data) {
      return res.json({ success: true, connected: false });
    }

    res.json({
      success: true,
      connected: data.TrangThaiKetNoi,
      googleEmail: data.GoogleEmail,
      connectedAt: data.NgayKetNoi,
      updatedAt: data.NgayCapNhat,
    });
  } catch (err) {
    console.error('status error:', err.message);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
});

// ── POST /api/google-calendar/disconnect ─────────────────────────────────────
// Removes the user's Google Calendar connection from DB.
router.post('/disconnect', authenticateToken, async (req, res) => {
  try {
    const { error } = await supabase
      .from('GoogleCalendarConnections')
      .delete()
      .eq('UserID', req.userId);

    if (error) throw new Error(error.message);

    res.json({ success: true, message: 'Đã ngắt kết nối Google Calendar' });
  } catch (err) {
    console.error('disconnect error:', err.message);
    res.status(500).json({ success: false, message: 'Lỗi khi ngắt kết nối' });
  }
});

// ── POST /api/google-calendar/sync-now ───────────────────────────────────────
// Pushes current week's LichTrinh events to Google Calendar.
router.post('/sync-now', authenticateToken, requireConfig, async (req, res) => {
  try {
    const result = await syncWeek(req.userId);
    res.json({
      success: true,
      message: `Đồng bộ hoàn tất: ${result.synced} sự kiện, ${result.errors} lỗi`,
      ...result,
    });
  } catch (err) {
    console.error('sync-now error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
