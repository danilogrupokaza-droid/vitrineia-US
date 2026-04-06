// src/services/sms.js
// ─────────────────────────────────────────────────────────────
// SMS service via Twilio A2P 10DLC.
// Always call isSuppressed() before sending — never bypass.
// ─────────────────────────────────────────────────────────────
'use strict';

const twilio = require('twilio');
const { isSuppressed, suppress } = require('../utils/suppression');
const supabase = require('../../config/supabase');

// Lazy init — only instantiate when credentials are present.
// This allows the app to boot without Twilio in early phases.
function getTwilioClient() {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN ||
      TWILIO_ACCOUNT_SID === 'your_account_sid_here') {
    return null;
  }
  return twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

/**
 * Send a single SMS after checking suppression list.
 *
 * @param {object} opts
 * @param {string} opts.to        – E.164 phone number
 * @param {string} opts.body      – Message text (max 160 chars recommended)
 * @param {string} opts.sequenceId – UUID of the sequence (for logging)
 * @param {number} opts.step      – Step number (for logging)
 * @returns {{ ok: boolean, sid?: string, error?: string }}
 */
async function sendSMS({ to, body, sequenceId, step = 0 }) {
  // 1. Suppression check — hard compliance gate
  const suppressed = await isSuppressed(to);
  if (suppressed) {
    console.log(`[sms] Suppressed: ${to} — skipping`);
    return { ok: false, error: 'suppressed' };
  }

  const client = getTwilioClient();
  if (!client) {
    // Twilio not configured yet — log and skip gracefully
    console.warn('[sms] Twilio not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.');
    return { ok: false, error: 'twilio_not_configured' };
  }

  const from = process.env.TWILIO_FROM_NUMBER;
  if (!from || from === '+1XXXXXXXXXX') {
    console.warn('[sms] TWILIO_FROM_NUMBER not set.');
    return { ok: false, error: 'from_number_not_set' };
  }

  try {
    const message = await client.messages.create({ to, from, body });

    // Log to sequence_events
    if (sequenceId) {
      await supabase.from('sequence_events').insert({
        sequence_id: sequenceId,
        step,
        channel: 'sms',
        status: 'sent',
        provider_id: message.sid,
        region: 'US',
      });
    }

    console.log(`[sms] Sent to ${to} | SID: ${message.sid}`);
    return { ok: true, sid: message.sid };

  } catch (err) {
    console.error(`[sms] Failed to send to ${to}:`, err.message);

    // Twilio error 21610 = unsubscribed number — auto-suppress
    if (err.code === 21610) {
      await suppress(to, 'sms', 'unsubscribe');
    }

    return { ok: false, error: err.message };
  }
}

module.exports = { sendSMS };
