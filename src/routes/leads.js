// src/routes/leads.js
'use strict';

const express  = require('express');
const { z }    = require('zod');
const supabase = require('../../config/supabase');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// ── Validation schema ─────────────────────────────────────────
const LeadSchema = z.object({
  full_name:    z.string().min(2).max(100),
  email:        z.string().email(),
  phone:        z.string().regex(/^\+1\d{10}$/, 'Phone must be in E.164 format: +1XXXXXXXXXX'),
  business_id:  z.string().uuid(),
  source:       z.enum(['instagram', 'cold_email', 'referral', 'organic', 'paid', 'other']).default('other'),
  notes:        z.string().max(500).optional(),
  // TCPA consent – required for SMS in the US
  sms_consent:  z.boolean().refine(val => val === true, {
    message: 'SMS consent is required (TCPA compliance).',
  }),
  email_consent: z.boolean().default(false),
});

// ── POST /api/leads ───────────────────────────────────────────
router.post('/', async (req, res) => {
  const parsed = LeadSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(422).json({
      error: 'Validation failed.',
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const data = parsed.data;

  // Check for duplicate (same email + business)
  const { data: existing } = await supabase
    .from('leads')
    .select('id, status')
    .eq('email', data.email)
    .eq('business_id', data.business_id)
    .maybeSingle();

  if (existing) {
    return res.status(409).json({
      error: 'Lead already exists for this business.',
      lead_id: existing.id,
      status: existing.status,
    });
  }

  const lead = {
    id:             uuidv4(),
    business_id:    data.business_id,
    full_name:      data.full_name,
    email:          data.email,
    phone:          data.phone,
    source:         data.source,
    notes:          data.notes ?? null,
    sms_consent:    data.sms_consent,
    email_consent:  data.email_consent,
    status:         'new',
    region:         'US',
  };

  const { error } = await supabase.from('leads').insert(lead);

  if (error) {
    console.error('[leads] insert error', error.message);
    return res.status(500).json({ error: 'Failed to save lead.' });
  }

  // Log to audit trail
  await supabase.from('audit_log').insert({
    table_name: 'leads',
    record_id:  lead.id,
    action:     'INSERT',
    payload:    { source: lead.source, status: lead.status },
    region:     'US',
  });

  return res.status(201).json({ lead_id: lead.id, status: 'new' });
});

// ── GET /api/leads/:id ────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('leads')
    .select('id, full_name, email, phone, source, status, created_at, business_id')
    .eq('id', req.params.id)
    .eq('region', 'US')
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data)  return res.status(404).json({ error: 'Lead not found.' });

  res.json(data);
});

// ── PATCH /api/leads/:id/status ───────────────────────────────
const StatusSchema = z.object({
  status: z.enum(['new', 'contacted', 'qualified', 'booked', 'lost', 'unsubscribed']),
});

router.patch('/:id/status', async (req, res) => {
  const parsed = StatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ error: 'Invalid status.', details: parsed.error.flatten().fieldErrors });
  }

  const { error } = await supabase
    .from('leads')
    .update({ status: parsed.data.status, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('region', 'US');

  if (error) return res.status(500).json({ error: error.message });

  await supabase.from('audit_log').insert({
    table_name: 'leads',
    record_id:  req.params.id,
    action:     'STATUS_CHANGE',
    payload:    { status: parsed.data.status },
    region:     'US',
  });

  res.json({ ok: true, status: parsed.data.status });
});

module.exports = router;
