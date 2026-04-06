// src/services/email.js
// ─────────────────────────────────────────────────────────────
// Email service via Resend.
// Always check suppression list before sending.
// ─────────────────────────────────────────────────────────────
'use strict';

const { Resend } = require('resend');
const { isSuppressed, suppress } = require('../utils/suppression');
const supabase = require('../../config/supabase');

function getClient() {
  const key = process.env.RESEND_API_KEY;
  if (!key || key === 'your_resend_api_key_here') return null;
  return new Resend(key);
}

/**
 * Send a transactional email after suppression check.
 *
 * @param {object} opts
 * @param {string} opts.to          – Recipient email
 * @param {string} opts.subject     – Email subject
 * @param {string} opts.body        – Plain text or HTML body
 * @param {string} [opts.sequenceId]
 * @param {number} [opts.step]
 * @returns {{ ok: boolean, id?: string, error?: string }}
 */
async function sendEmail({ to, subject, body, sequenceId, step = 0 }) {
  // Suppression check
  const suppressed = await isSuppressed(to);
  if (suppressed) {
    console.log(`[email] Suppressed: ${to} — skipping`);
    return { ok: false, error: 'suppressed' };
  }

  const client = getClient();
  if (!client) {
    console.warn('[email] Resend not configured. Set RESEND_API_KEY.');
    return { ok: false, error: 'resend_not_configured' };
  }

  const from = `${process.env.RESEND_FROM_NAME || 'VitrineIA'} <${process.env.RESEND_FROM_EMAIL || 'hello@yourdomain.com'}>`;

  // Convert plain text to basic HTML
  const html = body.includes('<') ? body : plainToHtml(body);

  try {
    const result = await client.emails.send({ from, to, subject, html, text: body });

    if (sequenceId) {
      await supabase.from('sequence_events').insert({
        sequence_id: sequenceId,
        step,
        channel:     'email',
        status:      'sent',
        provider_id: result.id,
        region:      'US',
      });
    }

    console.log(`[email] Sent to ${to} | ID: ${result.id}`);
    return { ok: true, id: result.id };

  } catch (err) {
    console.error(`[email] Failed to send to ${to}:`, err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Handle email unsubscribe — adds to suppression list.
 */
async function handleUnsubscribe(email) {
  await suppress(email, 'email', 'unsubscribe');
  console.log(`[email] Unsubscribed: ${email}`);
}

// Convert plain text to simple HTML
function plainToHtml(text) {
  return `<!DOCTYPE html>
<html>
<body style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #2C1F14; line-height: 1.7;">
${text
  .split('\n\n')
  .map(p => `<p style="margin: 0 0 16px 0;">${p.replace(/\n/g, '<br>')}</p>`)
  .join('\n')}
<hr style="border: none; border-top: 1px solid #E8DDD0; margin: 32px 0;">
<p style="font-size: 12px; color: #999;">
  You're receiving this because you requested information from us.
  <a href="mailto:${process.env.RESEND_FROM_EMAIL}?subject=Unsubscribe" style="color: #B8975A;">Unsubscribe</a>
</p>
</body>
</html>`;
}

module.exports = { sendEmail, handleUnsubscribe };
