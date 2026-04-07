// src/routes/stripe-webhook.js
// ─────────────────────────────────────────────────────────────
// Stripe webhook handler.
//
// Events handled:
//   checkout.session.completed       → payment received, activate business
//   invoice.payment_succeeded        → monthly renewal confirmed
//   invoice.payment_failed           → flag business as past_due
//   customer.subscription.deleted    → subscription cancelled
//   customer.subscription.updated    → plan change or cancellation scheduled
//
// Configure in Stripe Dashboard:
//   Developers → Webhooks → Add endpoint
//   URL: https://vitrineia-ca-production.up.railway.app/webhooks/stripe
//   Events: checkout.session.completed, invoice.payment_succeeded,
//           invoice.payment_failed, customer.subscription.deleted,
//           customer.subscription.updated
// ─────────────────────────────────────────────────────────────
'use strict';

const express  = require('express');
const supabase = require('../../config/supabase');
const { getStripe } = require('../services/stripe');
const { sendEmail } = require('../services/email');

const router = express.Router();

// Stripe requires the raw body for signature verification.
// This middleware must be applied BEFORE express.json() on this route.
router.use(express.raw({ type: 'application/json' }));

// ── POST /webhooks/stripe ─────────────────────────────────────
router.post('/', async (req, res) => {
  const stripe = getStripe();
  if (!stripe) {
    console.warn('[stripe-webhook] Stripe not configured — skipping.');
    return res.sendStatus(200); // return 200 so Stripe doesn't retry
  }

  const sig     = req.headers['stripe-signature'];
  const secret  = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret || secret === 'your_stripe_webhook_secret_here') {
    console.warn('[stripe-webhook] STRIPE_WEBHOOK_SECRET not set — skipping signature check.');
    // In dev/test you can skip this, but never in production.
    return res.sendStatus(200);
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error('[stripe-webhook] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`[stripe-webhook] Event: ${event.type}`);

  try {
    switch (event.type) {

      // ── Payment completed → activate business ───────────────
      case 'checkout.session.completed': {
        const session = event.data.object;
        await handleCheckoutCompleted(session);
        break;
      }

      // ── Monthly renewal confirmed ───────────────────────────
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        await handleInvoicePaid(invoice);
        break;
      }

      // ── Payment failed → flag business ─────────────────────
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        await handleInvoiceFailed(invoice);
        break;
      }

      // ── Subscription cancelled ──────────────────────────────
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await handleSubscriptionDeleted(sub);
        break;
      }

      // ── Subscription updated (plan change, cancel scheduled) ─
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        await handleSubscriptionUpdated(sub);
        break;
      }

      default:
        console.log(`[stripe-webhook] Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error(`[stripe-webhook] Error handling ${event.type}:`, err.message);
    // Return 200 anyway — returning 5xx causes Stripe to retry infinitely.
    return res.sendStatus(200);
  }

  res.sendStatus(200);
});

// ─────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────

async function handleCheckoutCompleted(session) {
  const { business_id, lead_id, plan } = session.metadata || {};
  if (!business_id) {
    console.warn('[stripe-webhook] checkout.session.completed missing business_id in metadata');
    return;
  }

  // 1. Update payment record
  await supabase
    .from('payments')
    .update({
      status:               'paid',
      stripe_payment_intent: session.payment_intent,
      paid_at:              new Date().toISOString(),
    })
    .eq('stripe_session_id', session.id);

  // 2. Activate business — set plan + billing_status
  await supabase
    .from('businesses')
    .update({
      plan:               plan || 'starter',
      billing_status:     'active',
      plan_activated_at:  new Date().toISOString(),
      stripe_customer_id: session.customer,
    })
    .eq('id', business_id);

  // 3. If linked to a lead, update lead status to 'qualified'
  if (lead_id) {
    await supabase
      .from('leads')
      .update({ status: 'qualified' })
      .eq('id', lead_id);
  }

  // 4. Pause any active follow-up sequences (client paid — stop outreach)
  if (lead_id) {
    await supabase
      .from('sequences')
      .update({ status: 'paused' })
      .eq('lead_id', lead_id)
      .eq('status', 'active');
  }

  // 5. Audit log
  await supabase.from('audit_log').insert({
    table_name: 'businesses',
    record_id:  business_id,
    action:     'PAYMENT_COMPLETED',
    payload:    { plan, session_id: session.id, customer: session.customer },
    region:     process.env.REGION || 'CA',
  });

  // 6. Send welcome email to business owner
  const { data: business } = await supabase
    .from('businesses')
    .select('name, owner_email')
    .eq('id', business_id)
    .maybeSingle();

  if (business?.owner_email) {
    await sendEmail({
      to:      business.owner_email,
      subject: `Welcome to NovuLeads — your ${plan} plan is active!`,
      body:    `Hi,\n\nYour NovuLeads ${plan} plan is now active for ${business.name}.\n\nYasmin from our team will reach out within 24 hours to start your onboarding and collect your assets (logo, hours, booking link).\n\nIf you have any questions in the meantime, just reply to this email.\n\nWelcome aboard!\n\nThe NovuLeads Team`,
    });
  }

  console.log(`[stripe-webhook] Business ${business_id} activated on plan ${plan}`);
}

async function handleInvoicePaid(invoice) {
  const customerId = invoice.customer;
  const subId      = invoice.subscription;
  if (!subId) return; // not a subscription invoice

  // Make sure subscription is marked active
  await supabase
    .from('subscriptions')
    .update({ status: 'active' })
    .eq('stripe_subscription_id', subId);

  // Make sure business billing_status is active
  await supabase
    .from('businesses')
    .update({ billing_status: 'active' })
    .eq('stripe_customer_id', customerId);

  await supabase.from('audit_log').insert({
    table_name: 'subscriptions',
    record_id:  subId,
    action:     'INVOICE_PAID',
    payload:    { invoice_id: invoice.id, amount: invoice.amount_paid },
    region:     process.env.REGION || 'CA',
  });

  console.log(`[stripe-webhook] Invoice paid for subscription ${subId}`);
}

async function handleInvoiceFailed(invoice) {
  const customerId = invoice.customer;
  const subId      = invoice.subscription;

  // Flag business as past_due
  await supabase
    .from('businesses')
    .update({ billing_status: 'past_due' })
    .eq('stripe_customer_id', customerId);

  if (subId) {
    await supabase
      .from('subscriptions')
      .update({ status: 'past_due' })
      .eq('stripe_subscription_id', subId);
  }

  await supabase.from('audit_log').insert({
    table_name: 'subscriptions',
    record_id:  subId || customerId,
    action:     'INVOICE_FAILED',
    payload:    { invoice_id: invoice.id, customer: customerId },
    region:     process.env.REGION || 'CA',
  });

  // Notify business owner
  const { data: business } = await supabase
    .from('businesses')
    .select('name, owner_email')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();

  if (business?.owner_email) {
    await sendEmail({
      to:      business.owner_email,
      subject: 'Action required — payment failed for NovuLeads',
      body:    `Hi,\n\nWe were unable to process your most recent payment for NovuLeads.\n\nPlease update your payment method to avoid service interruption:\nhttps://billing.stripe.com/p/login/\n\nIf you need help, reply to this email and we'll sort it out.\n\nThe NovuLeads Team`,
    });
  }

  console.log(`[stripe-webhook] Invoice payment failed for customer ${customerId}`);
}

async function handleSubscriptionDeleted(sub) {
  await supabase
    .from('subscriptions')
    .update({
      status:       'cancelled',
      cancelled_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', sub.id);

  await supabase
    .from('businesses')
    .update({ billing_status: 'cancelled' })
    .eq('stripe_customer_id', sub.customer);

  await supabase.from('audit_log').insert({
    table_name: 'subscriptions',
    record_id:  sub.id,
    action:     'SUBSCRIPTION_DELETED',
    payload:    { customer: sub.customer },
    region:     process.env.REGION || 'CA',
  });

  console.log(`[stripe-webhook] Subscription ${sub.id} cancelled`);
}

async function handleSubscriptionUpdated(sub) {
  const update = {
    status:               sub.status,
    cancel_at_period_end: sub.cancel_at_period_end,
    current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
    current_period_end:   new Date(sub.current_period_end   * 1000).toISOString(),
  };

  await supabase
    .from('subscriptions')
    .update(update)
    .eq('stripe_subscription_id', sub.id);

  console.log(`[stripe-webhook] Subscription ${sub.id} updated → status: ${sub.status}`);
}

module.exports = router;
