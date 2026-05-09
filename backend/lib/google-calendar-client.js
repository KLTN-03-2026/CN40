/**
 * google-calendar-client.js
 * OAuth2 setup, auth URL generation, callback handling, and per-user client factory.
 * Sync logic is in google-calendar-sync.js.
 */

const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
const { supabase } = require('../config/database');
const { encrypt, decrypt } = require('./token-encryption');

const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

/**
 * Returns true when Google OAuth env vars are configured.
 * @returns {boolean}
 */
function isConfigured() {
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REDIRECT_URI
  );
}

/**
 * Creates a base OAuth2 client (no credentials attached).
 * @returns {import('googleapis').Auth.OAuth2Client}
 */
function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

/**
 * Generates the Google OAuth2 consent URL.
 * Encodes userId in a short-lived JWT state param to survive the redirect.
 * @param {number} userId
 * @returns {string} consent URL
 */
function getAuthUrl(userId) {
  const client = createOAuth2Client();
  const state = jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',        // force refresh_token on every grant
    scope: SCOPES,
    state,
  });
}

/**
 * Exchanges authorization code for tokens and persists encrypted refresh_token.
 * @param {string} code  Authorization code from Google
 * @param {number} userId
 * @returns {Promise<{googleEmail: string}>}
 */
async function handleCallback(code, userId) {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error('Google did not return a refresh_token. User may need to revoke and reconnect.');
  }

  // Decode id_token to get Google email
  const idPayload = jwt.decode(tokens.id_token || '') || {};
  const googleEmail = idPayload.email || 'unknown@gmail.com';

  const encryptedRefresh = encrypt(tokens.refresh_token);

  const { error } = await supabase
    .from('GoogleCalendarConnections')
    .upsert(
      {
        UserID: userId,
        GoogleEmail: googleEmail,
        RefreshToken: encryptedRefresh,
        CalendarId: 'primary',
        TrangThaiKetNoi: true,
        NgayKetNoi: new Date().toISOString(),
        NgayCapNhat: new Date().toISOString(),
      },
      { onConflict: 'UserID' }
    );

  if (error) throw new Error(`DB upsert failed: ${error.message}`);

  return { googleEmail };
}

/**
 * Builds an authenticated OAuth2 client for a given user.
 * Loads encrypted refresh_token from DB, decrypts, sets credentials.
 * @param {number} userId
 * @returns {Promise<import('googleapis').Auth.OAuth2Client>}
 */
async function getClientForUser(userId) {
  const { data, error } = await supabase
    .from('GoogleCalendarConnections')
    .select('RefreshToken, CalendarId, TrangThaiKetNoi')
    .eq('UserID', userId)
    .single();

  if (error || !data) {
    throw new Error('Google Calendar chưa được kết nối');
  }
  if (!data.TrangThaiKetNoi) {
    throw new Error('Google Calendar kết nối đã bị tắt');
  }

  const refreshToken = decrypt(data.RefreshToken);
  const client = createOAuth2Client();
  client.setCredentials({ refresh_token: refreshToken });

  // Auto-refresh access token on expiry
  client.on('tokens', (tokens) => {
    if (tokens.refresh_token) {
      const newEncrypted = encrypt(tokens.refresh_token);
      supabase
        .from('GoogleCalendarConnections')
        .update({ RefreshToken: newEncrypted, NgayCapNhat: new Date().toISOString() })
        .eq('UserID', userId)
        .then(({ error: e }) => {
          if (e) console.error('Failed to rotate refresh_token for user', userId, e.message);
        });
    }
  });

  return { client, calendarId: data.CalendarId || 'primary' };
}

module.exports = { isConfigured, createOAuth2Client, getAuthUrl, handleCallback, getClientForUser };
