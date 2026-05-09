/**
 * google-calendar-sync.js
 * Sync logic: push LichTrinh events to Google Calendar (1-way: App → Google).
 * Handles create / update / delete actions and weekly bulk sync.
 */

const { google } = require('googleapis');
const { supabase } = require('../config/database');
const { getClientForUser } = require('./google-calendar-client');

/**
 * Converts a LichTrinh row into a Google Calendar event resource.
 * @param {object} row  LichTrinh row
 * @returns {object} Google Calendar event body
 */
function buildEventResource(row) {
  const startIso = row.ThoiGianBatDau
    ? new Date(row.ThoiGianBatDau).toISOString()
    : new Date().toISOString();

  const endIso = row.ThoiGianKetThuc
    ? new Date(row.ThoiGianKetThuc).toISOString()
    : new Date(new Date(startIso).getTime() + 60 * 60 * 1000).toISOString();

  return {
    summary: row.TieuDe || '(Công việc)',
    description: row.MoTa || '',
    start: { dateTime: startIso, timeZone: 'Asia/Ho_Chi_Minh' },
    end:   { dateTime: endIso,   timeZone: 'Asia/Ho_Chi_Minh' },
  };
}

/**
 * Creates, updates, or deletes a single event in Google Calendar.
 * Stores/clears GoogleEventId in LichTrinh after the operation.
 * Failures are logged but do NOT throw — fire-and-forget safe.
 *
 * @param {number} userId
 * @param {object} eventData  LichTrinh row (must have LichID)
 * @param {'create'|'update'|'delete'} action
 * @returns {Promise<{ok: boolean, googleEventId?: string, error?: string}>}
 */
async function syncEventToGoogle(userId, eventData, action) {
  try {
    const { client, calendarId } = await getClientForUser(userId);
    const calApi = google.calendar({ version: 'v3', auth: client });
    const lichId = eventData.LichID;

    if (action === 'delete') {
      const googleEventId = eventData.GoogleEventId;
      if (!googleEventId) return { ok: true }; // nothing to delete

      await calApi.events.delete({ calendarId, eventId: googleEventId }).catch(() => {});
      await supabase
        .from('LichTrinh')
        .update({ GoogleEventId: null })
        .eq('LichID', lichId);

      return { ok: true };
    }

    const resource = buildEventResource(eventData);

    if (action === 'update' && eventData.GoogleEventId) {
      const { data } = await calApi.events.update({
        calendarId,
        eventId: eventData.GoogleEventId,
        requestBody: resource,
      });
      return { ok: true, googleEventId: data.id };
    }

    // create (or re-create if GoogleEventId missing on update)
    const { data } = await calApi.events.insert({ calendarId, requestBody: resource });

    await supabase
      .from('LichTrinh')
      .update({ GoogleEventId: data.id })
      .eq('LichID', lichId);

    return { ok: true, googleEventId: data.id };
  } catch (err) {
    console.error(`syncEventToGoogle error (userId=${userId}, action=${action}):`, err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Syncs all events in the current ISO week for a user.
 * Events that already have a GoogleEventId are updated; others are created.
 * @param {number} userId
 * @returns {Promise<{synced: number, errors: number}>}
 */
async function syncWeek(userId) {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  const { data: events, error } = await supabase
    .from('LichTrinh')
    .select('*')
    .eq('UserID', userId)
    .gte('ThoiGianBatDau', monday.toISOString())
    .lte('ThoiGianBatDau', sunday.toISOString());

  if (error) throw new Error(`DB query failed: ${error.message}`);
  if (!events || events.length === 0) return { synced: 0, errors: 0 };

  let synced = 0;
  let errors = 0;

  for (const ev of events) {
    const action = ev.GoogleEventId ? 'update' : 'create';
    const result = await syncEventToGoogle(userId, ev, action);
    result.ok ? synced++ : errors++;
  }

  return { synced, errors };
}

module.exports = { syncEventToGoogle, syncWeek };
