// src/routes/outreach.js
// ─────────────────────────────────────────────────────────────
// Outreach endpoint — called by n8n workflows or directly.
// Sofia handles sales. Yasmin handles onboarding/ops.
// ─────────────────────────────────────────────────────────────
'use strict';

const express  = require('express');
const { z }    = require('zod');
const supabase = require('../../config/supabase');
const sofia    = require('../agents/sofia');
const yasmin   = require('../agents/yasmin');
const { sendSMS }   = require('../services/sms');
const { sendEmail } = require('../services/email');

const router = express.Router();

// ── Validation ────────────────────────────────────────────────
const OutreachSchema = z.object({
  lead_id:    z.string().uuid(),
  channel:    z.enum(['sms', 'email']),
  step:       z.number().int().min(0).default(0),
  agent:      z.enum(['sofia', 'yasmin']).default('sofia'),
  context:    z.string().max(500).optional(),
  sequence_id: z.string().uuid().optional(),
});

// ── POST /api/outreach/sms ────────────────────────────────────
router.post('/sms', async (req, res) => {
  const parsed = OutreachSchema.safeParse({ ...req.body, channel: 'sms' });
  if (!parsed.success) {
    return res.status(422).json({ error: 'Validation failed.', details: parsed.error.flatten().fieldErrors });
  }

  const { lead_id, step, agent, context, sequence_id } = parsed.data;
  const { lead, business, error } = await fetchLeadAndBusiness(lead_id);
  if (error) return res.status(404).json({ error });

  if (!lead.sms_consent) {
    return res.status(400).json({ error: 'Lead has no SMS consent.' });
  }

  // Generate message with the right agent
  const { body } = agent === 'yasmin'
    ? await yasmin.generateReminder({ lead, business, booking: null, channel: 'sms' })
    : await sofia.generateOutreach({ lead, business, channel: 'sms', step, context });

  const result = await sendSMS({ to: lead.phone, body, sequenceId: sequence_id, step });

  if (!result.ok) {
    return res.status(500).json({ error: result.error });
  }

  res.json({ ok: true, sid: result.sid, body });
});

// ── POST /api/outreach/email ──────────────────────────────────
router.post('/email', async (req, res) => {
  const parsed = OutreachSchema.safeParse({ ...req.body, channel: 'email' });
  if (!parsed.success) {
    return res.status(422).json({ error: 'Validation failed.', details: parsed.error.flatten().fieldErrors });
  }

  const { lead_id, step, agent, context, sequence_id } = parsed.data;
  const { lead, business, error } = await fetchLeadAndBusiness(lead_id);
  if (error) return res.status(404).json({ error });

  // Generate message with the right agent
  const { subject, body } = agent === 'yasmin'
    ? await yasmin.generateOnboarding({ lead, business, booking: null })
    : await sofia.generateOutreach({ lead, business, channel: 'email', step, context });

  const result = await sendEmail({ to: lead.email, subject, body, sequenceId: sequence_id, step });

  if (!result.ok) {
    return res.status(500).json({ error: result.error });
  }

  res.json({ ok: true, id: result.id, subject, body });
});

// ── POST /api/outreach/handoff ────────────────────────────────
// Sofia → Yasmin handoff when lead books a consultation
router.post('/handoff', async (req, res) => {
  const { lead_id, booking_id } = req.body;
  if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

  const { lead, business, error } = await fetchLeadAndBusiness(lead_id);
  if (error) return res.status(404).json({ error });

  // Get booking if provided
  let booking = null;
  if (booking_id) {
    const { data } = await supabase.from('bookings').select('*').eq('id', booking_id).maybeSingle();
    booking = data;
  }

  // Yasmin sends onboarding email
  const { subject, body } = await yasmin.generateOnboarding({ lead, business, booking });
  const emailResult = await sendEmail({ to: lead.email, subject, body });

  // Update lead status to booked
  await supabase.from('leads').update({ status: 'booked' }).eq('id', lead_id);

  // Scan for upsell opportunities
  const upsell = await yasmin.scanForUpsell({
    lead, business,
    notes: lead.notes || '',
  });

  if (upsell) {
    await supabase.from('audit_log').insert({
      table_name: 'leads',
      record_id:  lead_id,
      action:     'UPSELL_OPPORTUNITY',
      payload:    { opportunity: upsell },
      region:     'US',
    });
    console.log(`[handoff] Upsell opportunity for ${lead.full_name}: ${upsell}`);
  }

  res.json({
    ok:             true,
    onboarding_sent: emailResult.ok,
    upsell_found:    !!upsell,
    upsell,
  });
});

// ── Helper ────────────────────────────────────────────────────
async function fetchLeadAndBusiness(leadId) {
  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .eq('region', 'US')
    .maybeSingle();

  if (leadErr || !lead) return { error: 'Lead not found.' };

  const { data: business } = await supabase
    .from('businesses')
    .select('*')
    .eq('id', lead.business_id)
    .maybeSingle();

  return { lead, business: business || {}, error: null };
}

module.exports = router;
