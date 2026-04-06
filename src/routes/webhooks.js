// src/routes/webhooks.js
// ─────────────────────────────────────────────────────────────
// Twilio webhook endpoints.
// Configure in Twilio Console → Phone Numbers → your number
//   Messaging → A message comes in → Webhook → POST
//   URL: https://vitrineia-us-production.up.railway.app/webhooks/twilio/inbound
// ─────────────────────────────────────────────────────────────
'use strict';

const express  = require('express');
const twilio   = require('twilio');
const { suppress } = require('../utils/suppression');
const supabase = require('../../config/supabase');

const router = express.Router();

// Twilio sends form-encoded bodies
router.use(express.urlencoded({ extended: false }));

// ── Validate Twilio signature (security) ─────────────────────
function validateTwilio(req, res, next) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  // Skip validation if not configured yet
  if (!authToken || authToken === 'your_auth_token_here') {
    console.warn('[webhook] Twilio auth token not set — skipping signature validation');
    return next();
  }

  const signature = req.headers['x-twilio-signature'];
  const url = `${process.env.APP_URL}/webhooks/twilio/inbound`;

  const valid = twilio.validateRequest(authToken, signature, url, req.body);
  if (!valid) {
    console.warn('[webhook] Invalid Twilio signature');
    return res.status(403).send('Forbidden');
  }
  next();
}

// ── POST /webhooks/twilio/inbound ─────────────────────────────
// Handles incoming SMS replies from leads (STOP, YES, HELP, etc.)
router.post('/twilio/inbound', validateTwilio, async (req, res) => {
  const from = req.body.From;  // E.164 phone of the sender
  const body = (req.body.Body || '').trim().toUpperCase();

  console.log(`[webhook] Inbound SMS from ${from}: "${body}"`);

  // ── Opt-out keywords (TCPA required) ───────────────────────
  const OPT_OUT_KEYWORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];
  const OPT_IN_KEYWORDS  = ['START', 'YES', 'UNSTOP'];

  if (OPT_OUT_KEYWORDS.includes(body)) {
    await suppress(from, 'sms', 'unsubscribe');

    // Pause any active sequences for this phone
    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', from)
      .eq('region', 'US')
      .maybeSingle();

    if (lead) {
      await supabase
        .from('sequences')
        .update({ status: 'cancelled' })
        .eq('lead_id', lead.id)
        .eq('status', 'active');

      await supabase
        .from('leads')
        .update({ status: 'unsubscribed', opted_out_at: new Date().toISOString() })
        .eq('id', lead.id);
    }

    // Twilio expects TwiML response
    res.set('Content-Type', 'text/xml');
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>You have been unsubscribed and will receive no further messages. Reply START to re-subscribe.</Message>
</Response>`);
  }

  // ── Re-opt-in ───────────────────────────────────────────────
  if (OPT_IN_KEYWORDS.includes(body)) {
    // Remove from suppression list
    await supabase
      .from('suppression_list')
      .delete()
      .eq('contact', from)
      .eq('type', 'sms');

    res.set('Content-Type', 'text/xml');
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>You've been re-subscribed! You'll receive updates from us again.</Message>
</Response>`);
  }

  // ── "YES" / booking intent ──────────────────────────────────
  if (body === 'BOOK' || body.startsWith('YES')) {
    res.set('Content-Type', 'text/xml');
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Great! A member of our team will contact you shortly to schedule your appointment. Talk soon!</Message>
</Response>`);
  }

  // ── Default reply ───────────────────────────────────────────
  res.set('Content-Type', 'text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Thanks for your message! Our team will get back to you shortly. Reply STOP to unsubscribe.</Message>
</Response>`);
});

// ── POST /webhooks/twilio/status ──────────────────────────────
// Delivery status callbacks from Twilio
router.post('/twilio/status', (req, res) => {
  const { MessageSid, MessageStatus, To } = req.body;
  console.log(`[webhook] Status: ${MessageSid} → ${MessageStatus} (to: ${To})`);

  // Update sequence_events status
  if (MessageSid && MessageStatus) {
    supabase
      .from('sequence_events')
      .update({ status: MessageStatus })
      .eq('provider_id', MessageSid)
      .then(({ error }) => {
        if (error) console.error('[webhook] Failed to update event status:', error.message);
      });
  }

  res.sendStatus(204);
});

module.exports = router;
