// src/routes/payments.js
// ─────────────────────────────────────────────────────────────
// Payment endpoints.
//
// POST /api/payments/checkout  → Sofia calls this after closing a deal.
//                                Returns a Stripe Checkout URL to send to client.
//
// POST /api/payments/cancel    → Cancel subscription at period end.
//
// GET  /api/payments/:business_id → Get payment + subscription status.
// ─────────────────────────────────────────────────────────────
'use strict';

const express  = require('express');
const { z }    = require('zod');
const supabase = require('../../config/supabase');
const { createCheckoutSession, cancelSubscription, PLANS } = require('../services/stripe');
const { sendEmail } = require('../services/email');
const { sendSMS }   = require('../services/sms');

const router = express.Router();

// ── POST /api/payments/checkout ───────────────────────────────
// Sofia calls this to generate a payment link for a closed deal.
// Returns the Stripe Checkout URL — send it to the client via email or SMS.
const CheckoutSchema = z.object({
  business_id:   z.string().uuid(),
  lead_id:       z.string().uuid().optional(),
  plan:          z.enum(['starter', 'growth', 'full']).default('starter'),
  client_email:  z.string().email(),
  client_name:   z.string().min(2).max(100),
  // If true, automatically send the link to the client
  send_via:      z.enum(['email', 'sms', 'both', 'none']).default('email'),
  phone:         z.string().regex(/^\+1\d{10}$/).optional(), // required if send_via includes sms
});

router.post('/checkout', async (req, res) => {
  const parsed = CheckoutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ error: 'Validation failed.', details: parsed.error.flatten().fieldErrors });
  }

  const { business_id, lead_id, plan, client_email, client_name, send_via, phone } = parsed.data;

  // Fetch business for context
  const { data: business } = await supabase
    .from('businesses')
    .select('name, city, billing_status')
    .eq('id', business_id)
    .maybeSingle();

  if (!business) {
    return res.status(404).json({ error: 'Business not found.' });
  }

  // Create the Stripe Checkout Session
  const result = await createCheckoutSession({
    business_id,
    lead_id,
    plan,
    client_email,
    client_name,
  });

  if (!result.ok) {
    return res.status(500).json({ error: result.error });
  }

  const planConfig = PLANS[plan];
  const firstName  = client_name.split(' ')[0];
  const sent       = { email: false, sms: false };

  // Auto-send the link to the client if requested
  if (send_via === 'email' || send_via === 'both') {
    const subject = `Your NovuLeads setup link — ${business.name}`;
    const body    = `Hi ${firstName},\n\nGreat news — your ${planConfig.name} plan is ready to activate!\n\nUse the link below to complete your setup (takes about 2 minutes):\n\n${result.url}\n\nWhat's included:\n• Setup fee: CA$${(planConfig.setup_cents / 100).toFixed(0)}\n• Monthly plan: CA$${(planConfig.monthly_cents / 100).toFixed(0)}/month\n\nIf you have any questions before completing your payment, just reply to this email.\n\nLooking forward to getting you set up!\n\nSofia @ NovuLeads`;

    const emailResult = await sendEmail({ to: client_email, subject, body });
    sent.email = emailResult.ok;
  }

  if ((send_via === 'sms' || send_via === 'both') && phone) {
    const smsBody = `Hi ${firstName}! Your NovuLeads setup link is ready. Complete your ${plan} plan here: ${result.url} — Reply STOP to opt out.`;
    const smsResult = await sendSMS({ to: phone, body: smsBody });
    sent.sms = smsResult.ok;
  }

  // Log to audit trail
  await supabase.from('audit_log').insert({
    table_name: 'payments',
    record_id:  result.session_id,
    action:     'CHECKOUT_CREATED',
    payload:    { plan, business_id, lead_id, sent },
    region:     process.env.REGION || 'CA',
  });

  res.json({
    ok:         true,
    url:        result.url,
    session_id: result.session_id,
    plan,
    setup_fee:  `CA$${(planConfig.setup_cents / 100).toFixed(0)}`,
    monthly:    `CA$${(planConfig.monthly_cents / 100).toFixed(0)}/month`,
    sent,
  });
});

// ── GET /api/payments/:business_id ────────────────────────────
// Get payment and subscription status for a business.
router.get('/:business_id', async (req, res) => {
  const { business_id } = req.params;

  const [{ data: payments }, { data: subscription }, { data: business }] = await Promise.all([
    supabase.from('payments').select('*').eq('business_id', business_id).order('created_at', { ascending: false }).limit(5),
    supabase.from('subscriptions').select('*').eq('business_id', business_id).eq('status', 'active').maybeSingle(),
    supabase.from('businesses').select('name, plan, billing_status, stripe_customer_id, plan_activated_at').eq('id', business_id).maybeSingle(),
  ]);

  if (!business) return res.status(404).json({ error: 'Business not found.' });

  res.json({ business, payments: payments || [], subscription: subscription || null });
});

// ── POST /api/payments/cancel ─────────────────────────────────
// Cancel subscription at end of current billing period.
router.post('/cancel', async (req, res) => {
  const { business_id } = req.body;
  if (!business_id) return res.status(400).json({ error: 'business_id required.' });

  const result = await cancelSubscription(business_id);

  if (!result.ok) {
    return res.status(500).json({ error: result.error });
  }

  await supabase.from('audit_log').insert({
    table_name: 'businesses',
    record_id:  business_id,
    action:     'SUBSCRIPTION_CANCEL_REQUESTED',
    payload:    { cancel_at_period_end: true },
    region:     process.env.REGION || 'CA',
  });

  res.json({ ok: true, message: 'Subscription will cancel at end of current billing period.' });
});

module.exports = router;
