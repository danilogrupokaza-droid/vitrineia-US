// src/workers/reminder-worker.js
// ─────────────────────────────────────────────────────────────
// Processes scheduled reminders (24h + 2h before appointments).
// Run on cron every 5 minutes in Railway.
//
// To test manually:
//   node src/workers/reminder-worker.js
// ─────────────────────────────────────────────────────────────
'use strict';

require('dotenv').config();

const supabase       = require('../../config/supabase');
const { sendSMS }    = require('../services/sms');
const { sendEmail }  = require('../services/email');

const REMINDER_TEMPLATES = {
  reminder_24h: {
    sms: (name, time) =>
      `Hi ${name}! Reminder: your appointment is tomorrow at ${time}. Reply C to confirm or call us to reschedule. Reply STOP to opt out.`,
    email_subject: (name) => `See you tomorrow, ${name}! 🗓`,
    email_body: (name, time, business) =>
      `Hi ${name},\n\nJust a quick reminder that your appointment at ${business} is tomorrow at ${time}.\n\nIf you need to reschedule, just reply to this email or call us.\n\nSee you soon!\nThe Team @ ${business}`,
  },
  reminder_2h: {
    sms: (name, time) =>
      `Hey ${name}! Your appointment is in about 2 hours (${time}). See you soon! Need to reach us? Just reply here. Reply STOP to opt out.`,
    email_subject: (name) => `Your appointment is in 2 hours, ${name}`,
    email_body: (name, time, business) =>
      `Hi ${name},\n\nYour appointment at ${business} is coming up at ${time} today.\n\nSee you soon!\nThe Team @ ${business}`,
  },
};

async function runReminderWorker() {
  console.log(`[reminder-worker] Starting — ${new Date().toISOString()}`);

  // Fetch due reminder sequences
  const { data: sequences, error } = await supabase
    .from('sequences')
    .select(`
      id, lead_id, business_id, template, current_step,
      leads ( id, full_name, email, phone, sms_consent, email_consent ),
      businesses ( id, name, timezone )
    `)
    .in('template', ['reminder_24h', 'reminder_2h'])
    .eq('status', 'active')
    .eq('region', 'US')
    .lte('next_run_at', new Date().toISOString())
    .limit(50);

  if (error) {
    console.error('[reminder-worker] DB error:', error.message);
    return;
  }

  if (!sequences?.length) {
    console.log('[reminder-worker] No reminders due. Done.');
    return;
  }

  console.log(`[reminder-worker] Processing ${sequences.length} reminder(s)...`);

  for (const seq of sequences) {
    await processReminder(seq);
  }

  console.log('[reminder-worker] Done.');
}

async function processReminder(seq) {
  const lead     = seq.leads;
  const business = seq.businesses;
  const template = REMINDER_TEMPLATES[seq.template];

  if (!template) {
    console.warn(`[reminder-worker] Unknown template: ${seq.template}`);
    await markCompleted(seq.id);
    return;
  }

  // Get the booking to find appointment time
  const { data: booking } = await supabase
    .from('bookings')
    .select('scheduled_at, status')
    .eq('lead_id', lead.id)
    .eq('status', 'confirmed')
    .order('scheduled_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!booking) {
    console.log(`[reminder-worker] No confirmed booking for lead ${lead.id} — skipping`);
    await markCompleted(seq.id);
    return;
  }

  const firstName = lead.full_name?.split(' ')[0] || 'there';
  const apptTime  = new Date(booking.scheduled_at).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', timeZone: business.timezone || 'America/New_York',
  });
  const businessName = business.name || 'us';

  let sent = false;

  // Send SMS reminder
  if (lead.sms_consent && lead.phone) {
    const body   = template.sms(firstName, apptTime);
    const result = await sendSMS({ to: lead.phone, body, sequenceId: seq.id, step: 0 });
    if (result.ok) {
      sent = true;
      console.log(`[reminder-worker] SMS sent to ${lead.phone} (${seq.template})`);
    }
  }

  // Send email reminder
  if (lead.email_consent && lead.email) {
    const subject = template.email_subject(firstName);
    const body    = template.email_body(firstName, apptTime, businessName);
    const result  = await sendEmail({ to: lead.email, subject, body, sequenceId: seq.id, step: 0 });
    if (result.ok) {
      sent = true;
      console.log(`[reminder-worker] Email sent to ${lead.email} (${seq.template})`);
    }
  }

  // Mark sequence as completed
  await markCompleted(seq.id);

  if (!sent) {
    console.warn(`[reminder-worker] No channels available for lead ${lead.id}`);
  }
}

async function markCompleted(sequenceId) {
  await supabase
    .from('sequences')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', sequenceId);
}

// Run directly
if (require.main === module) {
  runReminderWorker().catch(err => {
    console.error('[reminder-worker] Fatal:', err);
    process.exit(1);
  });
}

module.exports = { runReminderWorker };
