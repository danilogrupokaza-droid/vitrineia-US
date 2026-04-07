// src/routes/calendly.js
// ─────────────────────────────────────────────────────────────
// Handles Calendly webhooks and schedules SMS reminders.
//
// Setup in Calendly:
//   Settings → Integrations → Webhooks → New Webhook
//   URL: https://vitrineia-us-production.up.railway.app/webhooks/calendly
//   Events: invitee.created, invitee.canceled
// ─────────────────────────────────────────────────────────────
'use strict';

const express  = require('express');
const crypto   = require('crypto');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../../config/supabase');

const router = express.Router();

// ── Verify Calendly signature ─────────────────────────────────
function verifyCalendly(req, res, next) {
  const secret    = process.env.CALENDLY_WEBHOOK_SECRET;
  const signature = req.headers['calendly-webhook-signature'];

  if (!secret || secret === 'your_webhook_secret_here') {
    console.warn('[calendly] Webhook secret not set — skipping verification');
    return next();
  }

  if (!signature) {
    return res.status(401).json({ error: 'Missing signature' });
  }

  // Calendly signature format: t=timestamp,v1=hash
  const parts = {};
  signature.split(',').forEach(part => {
    const [k, v] = part.split('=');
    parts[k] = v;
  });

  const payload  = `${parts.t}.${JSON.stringify(req.body)}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  if (expected !== parts.v1) {
    console.warn('[calendly] Invalid signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  next();
}

// ── POST /webhooks/calendly ───────────────────────────────────
router.post('/', express.json(), verifyCalendly, async (req, res) => {
  const { event, payload } = req.body;

  console.log(`[calendly] Event: ${event}`);

  try {
    if (event === 'invitee.created') {
      await handleBookingCreated(payload);
    } else if (event === 'invitee.canceled') {
      await handleBookingCanceled(payload);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('[calendly] Error processing webhook:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Handle new booking ────────────────────────────────────────
async function handleBookingCreated(payload) {
  const invitee      = payload.invitee;
  const event_type   = payload.event_type;
  const scheduled_at = payload.event?.start_time;

  const full_name = invitee.name;
  const email     = invitee.email;
  const phone     = extractPhone(invitee.questions_and_answers || []);

  console.log(`[calendly] New booking: ${full_name} (${email}) at ${scheduled_at}`);

  // 1. Find or create lead in Supabase
  const { data: existingLead } = await supabase
    .from('leads')
    .select('id, business_id')
    .eq('email', email.toLowerCase())
    .eq('region', 'US')
    .maybeSingle();

  let leadId = existingLead?.id;

  if (!leadId) {
    // Create new lead from Calendly booking
    const businessId = process.env.DEFAULT_BUSINESS_ID;
    if (!businessId) {
      console.warn('[calendly] DEFAULT_BUSINESS_ID not set — cannot create lead');
      return;
    }

    leadId = uuidv4();
    const { error } = await supabase.from('leads').insert({
      id:            leadId,
      business_id:   businessId,
      full_name,
      email:         email.toLowerCase(),
      phone:         phone || null,
      source:        'calendly',
      status:        'booked',
      sms_consent:   !!phone,
      email_consent: true,
      region:        'US',
    });

    if (error) {
      console.error('[calendly] Failed to create lead:', error.message);
      return;
    }
    console.log(`[calendly] Lead created: ${leadId}`);
  } else {
    // Update existing lead to booked
    await supabase
      .from('leads')
      .update({ status: 'booked' })
      .eq('id', leadId);
  }

  // 2. Save booking
  const bookingId = uuidv4();
  const { error: bookingErr } = await supabase.from('bookings').insert({
    id:           bookingId,
    lead_id:      leadId,
    business_id:  existingLead?.business_id || process.env.DEFAULT_BUSINESS_ID,
    scheduled_at,
    duration_min: 30,
    status:       'confirmed',
    source:       'calendly',
    notes:        `Event: ${event_type?.name || 'Haircut Consultation'}`,
    region:       'US',
  });

  if (bookingErr) {
    console.error('[calendly] Failed to save booking:', bookingErr.message);
  }

  // 3. Schedule reminders (24h + 2h before)
  if (phone && scheduled_at) {
    await scheduleReminders({
      leadId,
      bookingId,
      businessId: existingLead?.business_id || process.env.DEFAULT_BUSINESS_ID,
      scheduledAt: new Date(scheduled_at),
      phone,
      full_name,
    });
  }

  // 4. Audit log
  await supabase.from('audit_log').insert({
    table_name: 'bookings',
    record_id:  bookingId,
    action:     'CALENDLY_BOOKING',
    payload:    { email, scheduled_at, source: 'calendly' },
    region:     'US',
  });
}

// ── Handle cancellation ───────────────────────────────────────
async function handleBookingCanceled(payload) {
  const email = payload.invitee?.email;
  if (!email) return;

  // Find booking and mark as cancelled
  const { data: lead } = await supabase
    .from('leads')
    .select('id')
    .eq('email', email.toLowerCase())
    .eq('region', 'US')
    .maybeSingle();

  if (!lead) return;

  await supabase
    .from('bookings')
    .update({ status: 'cancelled' })
    .eq('lead_id', lead.id)
    .eq('status', 'confirmed');

  // Cancel pending reminder sequences
  await supabase
    .from('sequences')
    .update({ status: 'cancelled' })
    .eq('lead_id', lead.id)
    .eq('status', 'active')
    .like('template', 'reminder%');

  await supabase
    .from('leads')
    .update({ status: 'contacted' })
    .eq('id', lead.id);

  console.log(`[calendly] Booking cancelled for ${email}`);
}

// ── Schedule reminders ────────────────────────────────────────
async function scheduleReminders({ leadId, bookingId, businessId, scheduledAt, phone, full_name }) {
  const firstName = full_name?.split(' ')[0] || 'there';

  const reminders = [
    {
      label:    '24h reminder',
      template: 'reminder_24h',
      runAt:    new Date(scheduledAt.getTime() - 24 * 60 * 60 * 1000),
      body:     `Hi ${firstName}! Just a reminder — your appointment is tomorrow. Reply C to confirm or call us to reschedule. Reply STOP to opt out.`,
    },
    {
      label:    '2h reminder',
      template: 'reminder_2h',
      runAt:    new Date(scheduledAt.getTime() - 2 * 60 * 60 * 1000),
      body:     `Hey ${firstName}! Your appointment is in about 2 hours. See you soon! Questions? Reply here. Reply STOP to opt out.`,
    },
  ];

  for (const reminder of reminders) {
    // Skip if reminder time is in the past
    if (reminder.runAt <= new Date()) {
      console.log(`[calendly] Skipping ${reminder.label} — time already passed`);
      continue;
    }

    const { error } = await supabase.from('sequences').insert({
      id:           uuidv4(),
      lead_id:      leadId,
      business_id:  businessId,
      template:     reminder.template,
      status:       'active',
      current_step: 0,
      next_run_at:  reminder.runAt.toISOString(),
      region:       'US',
    });

    if (error) {
      console.error(`[calendly] Failed to schedule ${reminder.label}:`, error.message);
    } else {
      console.log(`[calendly] Scheduled ${reminder.label} for ${reminder.runAt.toISOString()}`);
    }
  }
}

// ── Extract phone from Calendly Q&A ──────────────────────────
function extractPhone(questions) {
  const phoneQ = questions.find(q =>
    q.question?.toLowerCase().includes('phone') ||
    q.question?.toLowerCase().includes('cell') ||
    q.question?.toLowerCase().includes('mobile')
  );

  if (!phoneQ?.answer) return null;

  const digits = phoneQ.answer.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
  return null;
}

module.exports = router;
