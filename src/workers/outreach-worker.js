// src/workers/outreach-worker.js
// ─────────────────────────────────────────────────────────────
// Sends cold email sequences to prospecting leads via Gmail.
// Runs every 30 minutes. Reads from leads_prospecting table,
// sends via Nodemailer + Gmail SMTP, updates status and
// schedules next step.
//
// Required env vars:
//   GMAIL_USER      → dan@novuleads.com
//   GMAIL_APP_PASS  → app password from Google Account settings
// ─────────────────────────────────────────────────────────────
'use strict';

require('dotenv').config();

const nodemailer = require('nodemailer');
const supabase   = require('../../config/supabase');

const BATCH_SIZE  = 25;         // max emails per run
const DELAYS_DAYS = [3, 4];     // days until next email after each step

// ── Gmail transporter (lazy init) ────────────────────────────
let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASS;

  if (!user || !pass ||
      user === 'dan@novuleads.com' ||
      pass === 'xxxx xxxx xxxx xxxx') {
    console.warn('[outreach] GMAIL_USER or GMAIL_APP_PASS not configured.');
    return null;
  }

  _transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });

  return _transporter;
}

// ── Email templates ───────────────────────────────────────────
function getTemplate(tentativa, lead) {
  const firstName = lead.nome?.split(' ')[0] || 'there';
  const shopName  = lead.nome   || 'your shop';
  const cidade    = lead.cidade || 'your area';

  const from = process.env.GMAIL_USER || 'dan@novuleads.com';

  const templates = [
    // ── Email 1 — first contact ───────────────────────────────
    {
      subject: `Quick question about ${shopName}`,
      text:
`Hey ${firstName},

Noticed ${shopName} has great reviews on Google but no easy way for clients to book or request a cut online.

We help barbershops in ${cidade} get more bookings with a simple system — landing page, booking form, and automatic follow-up texts to clients who reach out.

Takes 48h to set up. Would this be useful for you?

— Dan
NovuLeads | novuleads.com

---
Don't want to hear from us? Reply with STOP.`,
    },

    // ── Email 2 — follow-up (3 days later) ───────────────────
    {
      subject: `Re: Quick question about ${shopName}`,
      text:
`Hey ${firstName}, just following up.

Most barbershops we work with were losing 3–5 bookings a week just from not having an easy way for clients to reach them online.

The fix is simple and takes less than 48h. Happy to show you a quick example — no commitment.

— Dan
NovuLeads | novuleads.com

---
Don't want to hear from us? Reply with STOP.`,
    },

    // ── Email 3 — last touch (4 days after email 2) ──────────
    {
      subject: `Last one from me — ${shopName}`,
      text:
`Hey ${firstName},

Last follow-up — I don't want to clog your inbox.

If you ever want to add online booking and automatic follow-up texts to ${shopName}, reply and we'll set it up in 48h.

— Dan
NovuLeads | novuleads.com

---
Don't want to hear from us? Reply with STOP.`,
    },
  ];

  return templates[tentativa] || null;
}

// ── Send via Gmail ────────────────────────────────────────────
async function sendGmail({ to, subject, text }) {
  const transporter = getTransporter();
  if (!transporter) return { ok: false, error: 'gmail_not_configured' };

  const from = `Dan | NovuLeads <${process.env.GMAIL_USER}>`;

  try {
    const info = await transporter.sendMail({ from, to, subject, text });
    console.log(`[outreach] Sent to ${to} | MessageId: ${info.messageId}`);
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[outreach] Failed to send to ${to}:`, err.message);
    return { ok: false, error: err.message };
  }
}

// ── Main worker ───────────────────────────────────────────────
async function runOutreachWorker() {
  console.log(`[outreach] Starting — ${new Date().toISOString()}`);

  const now = new Date().toISOString();

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
    // Small delay between sends to avoid Gmail rate limits
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('[outreach] Done.');
}

async function processLead(lead) {
  const tentativa = lead.tentativas || 0;
  const template  = getTemplate(tentativa, lead);

  if (!template) {
    await supabase
      .from('leads_prospecting')
      .update({ status: 'sequencia_completa', updated_at: new Date().toISOString() })
      .eq('id', lead.id);
    return;
  }

  const result = await sendGmail({
    to:      lead.email,
    subject: template.subject,
    text:    template.text,
  });

  if (!result.ok) {
    console.error(`[outreach] Failed for ${lead.email}: ${result.error}`);
    return;
  }

  // Schedule next step
  const nextTentativa  = tentativa + 1;
  const delayDays      = DELAYS_DAYS[tentativa];
  const proximoContato = delayDays
    ? new Date(Date.now() + delayDays * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const novoStatus = nextTentativa >= 3 ? 'sequencia_completa' : 'em_contato';

  await supabase
    .from('leads_prospecting')
    .update({
      tentativas:      nextTentativa,
      email_enviado:   true,
      status:          novoStatus,
      ultimo_contato:  new Date().toISOString(),
      proximo_contato: proximoContato,
      updated_at:      new Date().toISOString(),
    })
    .eq('id', lead.id);

  console.log(`[outreach] Email ${nextTentativa}/3 → ${lead.email} (${lead.nome}) | next: ${proximoContato || 'none'}`);
}

// Allow running directly: node src/workers/outreach-worker.js
if (require.main === module) {
  runOutreachWorker().catch(err => {
    console.error('[outreach] Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { runOutreachWorker };
