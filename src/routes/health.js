// src/routes/health.js
'use strict';

const express  = require('express');
const supabase = require('../../config/supabase');

const router = express.Router();

router.get('/', async (req, res) => {
  // Lightweight DB ping — just checks connectivity.
  const { error } = await supabase.from('businesses').select('id').limit(1);

  if (error) {
    return res.status(503).json({
      status: 'unhealthy',
      region: process.env.REGION,
      db: 'unreachable',
      error: error.message,
    });
  }

  res.json({
    status: 'ok',
    region: process.env.REGION,
    db: 'connected',
    ts: new Date().toISOString(),
  });
});

module.exports = router;
