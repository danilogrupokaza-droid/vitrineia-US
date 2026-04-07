// src/services/stripe.js
// ─────────────────────────────────────────────────────────────
// Stripe service — checkout session creation and helpers.
//
// Flow:
//   1. Sofia closes the deal
//   2. POST /api/payments/checkout → creates Stripe Checkout Session
//   3. Sofia sends the session URL to the client (email or SMS)
//   4. Client pays setup fee + subscribes to monthly plan
//   5. Stripe fires webhook → POST /webhooks/stripe
//   6. Webhook activates the business in Supabase
// ─────────────────────────────────────────────────────────────
'use strict';

const Stripe   = require('stripe');
const supabase = require('../../config/supabase');

// Plan config: setup fee + monthly price IDs (set in Stripe Dashboard)
// Price IDs come from env so they can differ between test/live modes.
const PLANS = {
  starter: {
    name:          'NovuLeads Starter',
    setup_cents:   17900,   // CA$179
    monthly_cents:  8900,   // CA$89
    setup_price_id:   process.env.STRIPE_PRICE_STARTER_SETUP,
    monthly_price_id: process.env.STRIPE_PRICE_STARTER_MONTHLY,
  },
  growth: {
    name:          'NovuLeads Growth',
    setup_cents:   23900,   // CA$239
    monthly_cents: 16900,   // CA$169
    setup_price_id:   process.env.STRIPE_PRICE_GROWTH_SETUP,
    monthly_price_id: process.env.STRIPE_PRICE_GROWTH_MONTHLY,
  },
  full: {
    name:          'NovuLeads Full',
    setup_cents:   34900,   // CA$349
    monthly_cents: 27900,   // CA$279
    setup_price_id:   process.env.STRIPE_PRICE_FULL_SETUP,
    monthly_price_id: process.env.STRIPE_PRICE_FULL_MONTHLY,
  },
};

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key === 'your_stripe_secret_key_here') return null;
  return new Stripe(key, { apiVersion: '2024-06-20' });
}

/**
 * Create a Stripe Checkout Session with:
 *   - Line item 1: one-time setup fee
 *   - Line item 2: monthly subscription
 *
 * @param {object} opts
 * @param {string} opts.business_id  – UUID of the business being activated
 * @param {string} opts.lead_id      – UUID of the lead (for tracking)
 * @param {string} opts.plan         – 'starter' | 'growth' | 'full'
 * @param {string} opts.client_email – Pre-fill checkout email
 * @param {string} opts.client_name  – Pre-fill checkout name
 * @returns {{ ok: boolean, url?: string, session_id?: string, error?: string }}
 */
async function createCheckoutSession({ business_id, lead_id, plan = 'starter', client_email, client_name }) {
  const stripe = getStripe();
  if (!stripe) {
    return { ok: false, error: 'Stripe not configured. Set STRIPE_SECRET_KEY.' };
  }

  const planConfig = PLANS[plan];
  if (!planConfig) {
    return { ok: false, error: `Unknown plan: ${plan}` };
  }

  if (!planConfig.setup_price_id || !planConfig.monthly_price_id) {
    return { ok: false, error: `Stripe price IDs not configured for plan: ${plan}. Set STRIPE_PRICE_${plan.toUpperCase()}_SETUP and STRIPE_PRICE_${plan.toUpperCase()}_MONTHLY in env.` };
  }

  const appUrl = process.env.APP_URL_STRIPE || process.env.APP_URL || 'https://novuleads.com';

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      currency: 'cad',
      customer_email: client_email || undefined,

      // Pre-fill name if provided
      ...(client_name && {
        customer_creation: 'always',
      }),

      line_items: [
        // Setup fee (one-time, added as first invoice item)
        {
          price: planConfig.setup_price_id,
          quantity: 1,
        },
        // Monthly subscription
        {
          price: planConfig.monthly_price_id,
          quantity: 1,
        },
      ],

      // Subscription data
      subscription_data: {
        metadata: {
          business_id,
          lead_id:    lead_id || '',
          plan,
          region:     process.env.REGION || 'CA',
        },
      },

      // Pass metadata for webhook processing
      metadata: {
        business_id,
        lead_id:    lead_id || '',
        plan,
        region:     process.env.REGION || 'CA',
      },

      // Redirect URLs
      success_url: `${appUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${appUrl}/payment-cancelled`,

      // Allow promo codes
      allow_promotion_codes: true,
    });

    // Save pending payment record in Supabase
    await supabase.from('payments').insert({
      business_id,
      lead_id:              lead_id || null,
      stripe_session_id:    session.id,
      amount_cents:         planConfig.setup_cents,
      currency:             'cad',
      status:               'pending',
      plan,
      region:               process.env.REGION || 'CA',
    });

    console.log(`[stripe] Checkout session created: ${session.id} | plan: ${plan} | business: ${business_id}`);

    return { ok: true, url: session.url, session_id: session.id };

  } catch (err) {
    console.error('[stripe] Failed to create checkout session:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Get or create a Stripe Customer for a business.
 */
async function getOrCreateCustomer({ business_id, email, name }) {
  const stripe = getStripe();
  if (!stripe) return null;

  // Check if business already has a customer
  const { data: business } = await supabase
    .from('businesses')
    .select('stripe_customer_id')
    .eq('id', business_id)
    .maybeSingle();

  if (business?.stripe_customer_id) {
    return business.stripe_customer_id;
  }

  // Create new customer
  const customer = await stripe.customers.create({
    email,
    name,
    metadata: { business_id, region: process.env.REGION || 'CA' },
  });

  await supabase
    .from('businesses')
    .update({ stripe_customer_id: customer.id })
    .eq('id', business_id);

  return customer.id;
}

/**
 * Cancel a subscription at period end.
 */
async function cancelSubscription(business_id) {
  const stripe = getStripe();
  if (!stripe) return { ok: false, error: 'Stripe not configured.' };

  const { data: sub } = await supabase
    .from('subscriptions')
    .select('stripe_subscription_id')
    .eq('business_id', business_id)
    .eq('status', 'active')
    .maybeSingle();

  if (!sub) return { ok: false, error: 'No active subscription found.' };

  try {
    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      cancel_at_period_end: true,
    });

    await supabase
      .from('subscriptions')
      .update({ cancel_at_period_end: true })
      .eq('stripe_subscription_id', sub.stripe_subscription_id);

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { createCheckoutSession, getOrCreateCustomer, cancelSubscription, PLANS, getStripe };
