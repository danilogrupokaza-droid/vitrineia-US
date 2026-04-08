// config/supabase.js
// ─────────────────────────────────────────────────────────────
// Supabase client for VitrineIA US.
// Uses the SERVICE role key server-side (never expose to client).
// ─────────────────────────────────────────────────────────────
'use strict';

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error(
    '[vitrineia-us] SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in environment variables.'
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

module.exports = supabase;
