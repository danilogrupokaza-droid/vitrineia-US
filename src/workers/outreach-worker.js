// src/workers/outreach-worker.js
// ─────────────────────────────────────────────────────────────
// Sends cold email sequences to prospecting leads.
// Runs every 30 minutes. Reads from leads_prospecting table,
// sends via Resend, updates status and schedules next step.
// ─────────────────────────────────────────────────────────────
'use strict';

require('dotenv').config();

const supabase      = require('../../config/supabase');
const { sendEmail } = require('../services/email');

const BATCH_SIZE = 25; // max emails per run

// ── Email templates ───────────────────────────────────────────
function getEmailTemplate(tentativa, lead) {
  const firstName = lead.nome?.split(' ')[0] || 'there';
  const shopName  = lead.nome  || 'your shop';
  const cidade    = lead.cidade || 'your area';

  const templates = [
    // Email 1 — first contact
    {
      subject: `Quick question about ${shopName}`,
      body: `Hey ${firstName},

Noticed ${shopName} has great reviews on Google but no easy way for clients to book or request a cut online.

We help barbershops in ${cidade} get more bookings with a simple system — landing page, booking form, and automatic follow-up texts to clients who reach out.

Takes 48h to set up. Would this be useful for you?

— Dan
VitrineIA`,
    },

    // Email 2 — follow-up (3 days later)
    {
      subject: `Re: Quick question about ${shopName}`,
      body: `Hey ${firstName}, just following up.

Most barbershops we work with were losing 3–5 bookings a week just from not having an easy way for clients to reach them online.

The fix is simple and takes less than 48h. Happy to show you a quick example — no commitment.

— Dan
VitrineIA`,
    },

    // Email 3 — last touch (4 days after email 2)
    {
      subject: `Last one from me — ${shopName}`,
      body: `Hey ${firstName},

Last follow-up — I don't want to clog your inbox.

If you ever want to add online booking and automatic follow-up texts to ${shopName}, reply and we'll set it up in 48h.

— Dan
VitrineIA`,
    },
  ];

  return templates[tentativa] || null;
}

// ── Delays between emails (in days) ──────────────────────────
const DELAYS_DAYS = [3, 4]; // after email 1 → 3d, after email 2 → 4d

// ── Main worker ───────────────────────────────────────────────
async function runOutreachWorker() {
  console.log(`[outreach] Starting — ${new Date().toISOString()}`);

  const now = new Date().toISOString();

  // Fetch leads ready for outreach:
  // - have email
  // - status is 'novo' OR proximo_contato is due
  // - not yet at 3 attempts
  const { data: leads, error } = await supabase
    .from('leads_prospecting')
    .select('*')
    .eq('regiao', 'US')
    .not('email', 'is', null)
    .lt('tentativas', 3)
    .or(`status.eq.novo,proximo_contato.lte.${now}`)
    .order('score', { ascending: false })
    .limit(BATCH_SIZE);

  if (error) {
    console.error('[outreach] Failed to fetch leads:', error.message);
    return;
  }

  if (!leads || leads.length === 0) {
    console.log('[outreach] No leads due. Done.');
    return;
  }

  console.log(`[outreach] Processing ${leads.length} lead(s)...`);

  for (const lead of leads) {
    await processLead(lead);
  }

  console.log('[outreach] Done.');
}

async function processLead(lead) {
  const tentativa = lead.tentativas || 0;
  const template  = getEmailTemplate(tentativa, lead);

  if (!template) {
    // No more emails — mark as sequence complete
    await supabase
      .from('leads_prospecting')
      .update({ status: 'sequencia_completa', updated_at: new Date().toISOString() })
      .eq('id', lead.id);
    return;
  }

  // Send email
  const result = await sendEmail({
    to:      lead.email,
    subject: template.subject,
    body:    template.body,
  });

  if (!result.ok) {
    console.error(`[outreach] Failed for ${lead.email}: ${result.error}`);

    // If suppressed, mark lead accordingly
    if (result.error === 'suppressed') {
      await supabase
        .from('leads_prospecting')
        .update({ status: 'descadastrado', updated_at: new Date().toISOString() })
        .eq('id', lead.id);
    }
    return;
  }

  // Calculate next send date
  const nextTentativa   = tentativa + 1;
  const delayDays       = DELAYS_DAYS[tentativa];
  const proximoContato  = delayDays
    ? new Date(Date.now() + delayDays * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const novoStatus = nextTentativa >= 3 ? 'sequencia_completa' : 'em_contato';

  await supabase
    .from('leads_prospecting')
    .update({
      tentativas:     nextTentativa,
      email_enviado:  true,
      status:         novoStatus,
      ultimo_contato: new Date().toISOString(),
      proximo_contato: proximoContato,
      updated_at:     new Date().toISOString(),
    })
    .eq('id', lead.id);

  console.log(`[outreach] Sent email ${nextTentativa}/3 to ${lead.email} (${lead.nome}) | next: ${proximoContato || 'none'}`);
}

// Allow running directly: node src/workers/outreach-worker.js
if (require.main === module) {
  runOutreachWorker().catch(err => {
    console.error('[outreach] Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { runOutreachWorker };
