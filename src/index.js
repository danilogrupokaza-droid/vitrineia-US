// src/index.js
'use strict';

require('dotenv').config();

const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const morgan  = require('morgan');
const rateLimit = require('express-rate-limit');

const supabase = require('../config/supabase');

const leadsRouter  = require('./routes/leads');
const healthRouter = require('./routes/health');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS – allow all vercel.app subdomains + localhost ────────
const corsOptions = {
  origin: (origin, callback) => {
    // Allow: no origin (curl/Postman), localhost, any vercel.app subdomain
    if (
      !origin ||
      origin.startsWith('http://localhost') ||
      origin.endsWith('.vercel.app') ||
      origin === process.env.APP_URL
    ) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // preflight for all routes

// ── Security ──────────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

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
