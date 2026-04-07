// src/routes/setup.js
// ─────────────────────────────────────────────────────────────
// One-time setup endpoints.
// Run these once after deploying — they configure external
// services automatically so you don't need to use their dashboards.
//
// POST /api/setup/stripe-webhook
//   → Registers the Stripe webhook endpoint via API and prints
//     the whsec_ secret to the Railway logs.
//     After running, copy the secret from logs and add it as
//     STRIPE_WEBHOOK_SECRET in Railway variables.
//
// Protected by API_SECRET header to prevent accidental public calls.
// ─────────────────────────────────────────────────────────────
'use strict';

const express = require('express');
const { getStripe } = require('../services/stripe');

const router = express.Router();

// ── Auth middleware — requires x-api-secret header ────────────
function requireSecret(req, res, next) {
  const secret = process.env.API_SECRET_STRIPE;
  if (!secret) {
    return res.status(500).json({ error: 'API_SECRET_STRIPE not configured in environment.' });
  }
  if (req.headers['x-api-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }
  next();
}

// ── POST /api/setup/stripe-webhook ────────────────────────────
router.post('/stripe-webhook', requireSecret, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) {
    return res.status(500).json({ error: 'STRIPE_SECRET_KEY not configured.' });
  }

  const appUrl = process.env.APP_URL_STRIPE;
  if (!appUrl || appUrl === 'http://localhost:3000') {
    return res.status(400).json({
      error: 'APP_URL must be set to your production Railway URL before registering the webhook.',
      hint:  'Set APP_URL_STRIPE=https://vitrineia-ca-production.up.railway.app in Railway variables.',
    });
  }

  const webhookUrl = `${appUrl}/webhooks/stripe`;

  // Check if webhook already exists for this URL
  try {
    const existing = await stripe.webhookEndpoints.list({ limit: 20 });
    const alreadyExists = existing.data.find(w => w.url === webhookUrl);

    if (alreadyExists) {
      return res.status(200).json({
        ok:      true,
        message: 'Webhook already registered.',
        id:      alreadyExists.id,
        url:     alreadyExists.url,
        status:  alreadyExists.status,
        note:    'The signing secret (whsec_) is only shown once at creation time. If you lost it, delete this webhook and run this endpoint again.',
      });
    }

    // Create the webhook endpoint
    const webhook = await stripe.webhookEndpoints.create({
      url: webhookUrl,
      enabled_events: [
        'checkout.session.completed',
        'invoice.payment_succeeded',
        'invoice.payment_failed',
        'customer.subscription.deleted',
        'customer.subscription.updated',
      ],
      description: 'NovuLeads CA — auto-registered via setup API',
    });

    // Log the secret to Railway logs (only place it appears)
    console.log('─────────────────────────────────────────────────');
    console.log('[setup] Stripe webhook registered successfully!');
    console.log(`[setup] Webhook ID  : ${webhook.id}`);
    console.log(`[setup] Webhook URL : ${webhook.url}`);
    console.log(`[setup] Signing secret (copy this to Railway):`);
    console.log(`[setup] STRIPE_WEBHOOK_SECRET=${webhook.secret}`);
    console.log('─────────────────────────────────────────────────');

    return res.status(201).json({
      ok:      true,
      message: 'Webhook registered. Copy STRIPE_WEBHOOK_SECRET from Railway logs now — it will not be shown again.',
      id:      webhook.id,
      url:     webhook.url,
      status:  webhook.status,
      events:  webhook.enabled_events,
    });

  } catch (err) {
    console.error('[setup] Failed to register Stripe webhook:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/setup/stripe-webhook ─────────────────────────────
// Check current webhook registration status.
router.get('/stripe-webhook', requireSecret, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) {
    return res.status(500).json({ error: 'STRIPE_SECRET_KEY not configured.' });
  }

  const appUrl  = process.env.APP_URL_STRIPE;
  const webhookUrl = `${appUrl}/webhooks/stripe`;

  try {
    const existing = await stripe.webhookEndpoints.list({ limit: 20 });
    const found    = existing.data.find(w => w.url === webhookUrl);

    const webhookSecretSet = !!(
      process.env.STRIPE_WEBHOOK_SECRET &&
      process.env.STRIPE_WEBHOOK_SECRET !== 'your_stripe_webhook_secret_here'
    );

    return res.json({
      webhook_registered:    !!found,
      webhook_secret_in_env: webhookSecretSet,
      webhook:               found || null,
      next_step:             !found
        ? 'Run POST /api/setup/stripe-webhook to register.'
        : !webhookSecretSet
        ? 'Webhook registered but STRIPE_WEBHOOK_SECRET is not set in Railway. Check the logs from when you ran POST /api/setup/stripe-webhook.'
        : 'All good — webhook registered and secret is set.',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/setup/stripe-webhook ─────────────────────────
// Delete and re-register webhook (e.g. if you lost the secret).
router.delete('/stripe-webhook', requireSecret, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) {
    return res.status(500).json({ error: 'STRIPE_SECRET_KEY not configured.' });
  }

  const appUrl     = process.env.APP_URL_STRIPE;
  const webhookUrl = `${appUrl}/webhooks/stripe`;

  try {
    const existing = await stripe.webhookEndpoints.list({ limit: 20 });
    const found    = existing.data.find(w => w.url === webhookUrl);

    if (!found) {
      return res.status(404).json({ error: 'No webhook found for this URL.', url: webhookUrl });
    }

    await stripe.webhookEndpoints.del(found.id);
    console.log(`[setup] Webhook ${found.id} deleted. Run POST /api/setup/stripe-webhook to re-register and get a new secret.`);

    return res.json({
      ok:      true,
      message: 'Webhook deleted. Run POST /api/setup/stripe-webhook to re-register and get a fresh whsec_.',
      deleted: found.id,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
