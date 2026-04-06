// config/supabase.js
// ─────────────────────────────────────────────────────────────
// Supabase client for VitrineIA US.
// Uses the SERVICE role key server-side (never expose to client).
// ─────────────────────────────────────────────────────────────
'use strict';

const { createClient } = require('@supabase/supabase-js');

// Hard guard: fail fast if someone accidentally points this repo
// at a BR Supabase project or forgets to set the region.
if (process.env.REGION !== 'US') {
  throw new Error(
    `[vitrineia-us] REGION env var must be "US". Got: "${process.env.REGION}". ` +
    'Check your .env file and make sure you are not mixing BR and US configs.'
  );
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error(
    '[vitrineia-us] SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env'
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

module.exports = supabase;
