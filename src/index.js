// src/index.js
'use strict';

require('dotenv').config();

const express   = require('express');
const morgan    = require('morgan');
const rateLimit = require('express-rate-limit');

const supabase = require('../config/supabase');

const leadsRouter    = require('./routes/leads');
const healthRouter   = require('./routes/health');
const webhooksRouter = require('./routes/webhooks');
const outreachRouter = require('./routes/outreach');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS manual (before everything, including helmet) ─────────
// This runs first so no other middleware can override the headers.
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  const allowed =
    !origin ||
    origin.startsWith('http://localhost') ||
    origin.endsWith('.vercel.app') ||
    origin === process.env.APP_URL;

  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }

  // Respond to preflight immediately
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

// ── Rate limiting ─────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
app.use(limiter);

// ── Parsing & logging ─────────────────────────────────────────
app.use(express.json({ limit: '50kb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── Routes ────────────────────────────────────────────────────
app.use('/health', healthRouter);
app.use('/api/leads', leadsRouter);
app.use('/webhooks', webhooksRouter);
app.use('/api/outreach', outreachRouter);

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

// ── Global error handler ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: 'Internal server error.' });
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[vitrineia-us] Running on port ${PORT} | NODE_ENV=${process.env.NODE_ENV} | REGION=${process.env.REGION}`);
});

module.exports = app;
