// src/workers/sequence-worker.js
// ─────────────────────────────────────────────────────────────
// Polls Supabase for sequences due to run and sends SMS steps.
// In production, call runWorker() on a cron (e.g. every 5 min).
// Can also be triggered manually: node src/workers/sequence-worker.js
// ─────────────────────────────────────────────────────────────
'use strict';

require('dotenv').config();

const supabase          = require('../../config/supabase');
const { sendSMS }       = require('../services/sms');
const { sendEmail }     = require('../services/email');
const { getTemplate }   = require('../services/sequences');

const WORKER_BATCH = 20; // max sequences to process per run

async function runWorker() {
  console.log(`[worker] Starting sequence worker — ${new Date().toISOString()}`);

  // 1. Fetch sequences due to run
  const { data: sequences, error } = await supabase
    .from('sequences')
    .select(`
      id, lead_id, business_id, template, current_step, next_run_at,
      leads ( id, full_name, email, phone, sms_consent ),
      businesses ( id, name, niche, plan, timezone )
    `)
    .eq('status', 'active')
    .eq('region', process.env.REGION || 'CA')
    .lte('next_run_at', new Date().toISOString())
    .limit(WORKER_BATCH);

  if (error) {
    console.error('[worker] Failed to fetch sequences:', error.message);
    return;
  }

  if (!sequences || sequences.length === 0) {
    console.log('[worker] No sequences due. Done.');
    return;
  }

  console.log(`[worker] Processing ${sequences.length} sequence(s)...`);

  for (const seq of sequences) {
    await processSequence(seq);
  }

  console.log('[worker] Done.');
}

async function processSequence(seq) {
  const lead     = seq.leads;
  const business = seq.businesses;
  const template = getTemplate(business?.niche, business?.plan);

  const step = template[seq.current_step];

  if (!step) {
    // No more steps — mark sequence as completed
    await supabase
      .from('sequences')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', seq.id);
    console.log(`[worker] Sequence ${seq.id} completed.`);
    return;
  }

  // SMS step
  if (step.channel === 'sms') {
    if (!lead.sms_consent) {
      console.log(`[worker] Lead ${lead.id} has no SMS consent — skipping SMS step.`);
    } else if (!lead.phone) {
      console.log(`[worker] Lead ${lead.id} has no phone — skipping SMS step.`);
    } else {
      const firstName = lead.full_name?.split(' ')[0] || 'there';
      const body = step.body(
        { ...lead, first_name: firstName },
        business
      );

      await sendSMS({
        to:         lead.phone,
        body,
        sequenceId: seq.id,
        step:       seq.current_step,
      });
    }
  }

  // Advance to next step or complete
  const nextStep = seq.current_step + 1;
  const nextTemplate = template[nextStep];

  if (nextTemplate) {
    const nextRunAt = new Date(
      Date.now() + nextTemplate.delay_minutes * 60 * 1000
    ).toISOString();

    await supabase
      .from('sequences')
      .update({ current_step: nextStep, next_run_at: nextRunAt })
      .eq('id', seq.id);

    console.log(`[worker] Sequence ${seq.id} → step ${nextStep}, next run: ${nextRunAt}`);
  } else {
    await supabase
      .from('sequences')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', seq.id);

    console.log(`[worker] Sequence ${seq.id} completed after step ${seq.current_step}.`);
  }
}

// Allow running directly: node src/workers/sequence-worker.js
if (require.main === module) {
  runWorker().catch(err => {
    console.error('[worker] Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { runWorker };
