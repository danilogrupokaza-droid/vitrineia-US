// src/agents/sofia.js
// ─────────────────────────────────────────────────────────────
// Sofia US – Sales agent.
// Responsibilities: qualify leads, write outreach emails/SMS,
// handle objections, book consultation calls.
// ─────────────────────────────────────────────────────────────
'use strict';

const Anthropic = require('@anthropic-ai/sdk');

function getClient() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key === 'your_anthropic_key_here') return null;
  return new Anthropic({ apiKey: key });
}

// ── Sofia's system prompt ─────────────────────────────────────
const SOFIA_SYSTEM = `You are Sofia, a friendly and professional sales representative for NovuLeads, serving local barbershops in Canada.

Your role:
- Write warm, personalized outreach messages (email or SMS) to leads who requested a booking or consultation
- Qualify leads by understanding their interest and timing
- Handle common objections (price, loyalty to current barber, timing)
- Encourage leads to book their first appointment
- Always be helpful, never pushy

Tone: casual, confident, direct. Like a friend who knows a great barber and genuinely wants to help.

Rules:
- Keep SMS under 160 characters when possible
- Always include opt-out instructions in SMS: "Reply STOP to opt out"
- Never overpromise on style results
- Never mention competitor prices
- Always sign off as "Sofia @ [Business Name]"
- You are operating in Canada — references to compliance should respect CASL, not TCPA`;

/**
 * Generate a personalized outreach message for a lead.
 *
 * @param {object} opts
 * @param {object} opts.lead      – Lead record { full_name, email, phone, notes, source }
 * @param {object} opts.business  – Business record { name, niche, city, state }
 * @param {'email'|'sms'} opts.channel
 * @param {number} opts.step      – Sequence step (0 = first contact, 1 = follow-up, etc.)
 * @param {string} [opts.context] – Extra context (e.g. "lead hasn't replied in 24h")
 * @returns {Promise<{ subject?: string, body: string }>}
 */
async function generateOutreach({ lead, business, channel, step = 0, context = '' }) {
  const client = getClient();
  if (!client) {
    console.warn('[sofia] ANTHROPIC_API_KEY not set — returning template fallback');
    return fallbackMessage({ lead, business, channel, step });
  }

  const firstName = lead.full_name?.split(' ')[0] || 'there';
  const interest  = lead.notes?.replace('Interest: ', '') || 'our treatments';
  const stepLabel = step === 0 ? 'first outreach' : `follow-up #${step}`;

  const prompt = `
Business: ${business.name} (${business.niche?.replace('_', ' ')}) in ${business.city}, ${business.state}
Lead name: ${firstName}
Lead interest: ${interest}
Lead source: ${lead.source}
Channel: ${channel}
Step: ${stepLabel}
${context ? `Context: ${context}` : ''}

Write a ${channel === 'sms' ? 'short SMS (max 160 chars)' : 'personalized email'} for this lead.
${channel === 'email' ? 'Include a subject line on the first line, formatted as: Subject: [subject here]' : ''}
Make it feel personal and human, not like a template.
  `.trim();

  const message = await client.messages.create({
    model:      'claude-sonnet-4-5-20251022',
    max_tokens: 400,
    system:     SOFIA_SYSTEM,
    messages:   [{ role: 'user', content: prompt }],
  });

  const text = message.content[0]?.text || '';

  if (channel === 'email') {
    const lines   = text.split('\n');
    const subjLine = lines.find(l => l.startsWith('Subject:'));
    const subject  = subjLine ? subjLine.replace('Subject:', '').trim() : `Your free consultation at ${business.name}`;
    const body     = lines.filter(l => !l.startsWith('Subject:')).join('\n').trim();
    return { subject, body };
  }

  return { body: text.trim() };
}

/**
 * Generate a reply to an inbound message from a lead.
 *
 * @param {object} opts
 * @param {object} opts.lead
 * @param {object} opts.business
 * @param {string} opts.inboundMessage – What the lead said
 * @param {string} opts.channel
 * @returns {Promise<{ body: string }>}
 */
async function generateReply({ lead, business, inboundMessage, channel }) {
  const client = getClient();
  if (!client) {
    return { body: `Hi! Thanks for reaching out to ${business.name}. We'll get back to you shortly!` };
  }

  const firstName = lead.full_name?.split(' ')[0] || 'there';

  const prompt = `
Business: ${business.name} in ${business.city}, ${business.state}
Lead name: ${firstName}
Channel: ${channel}
Lead message: "${inboundMessage}"

Write a helpful, warm reply. Keep it conversational.
${channel === 'sms' ? 'Keep under 160 characters. Include "Reply STOP to opt out."' : ''}
  `.trim();

  const message = await client.messages.create({
    model:      'claude-sonnet-4-5-20251022',
    max_tokens: 200,
    system:     SOFIA_SYSTEM,
    messages:   [{ role: 'user', content: prompt }],
  });

  return { body: message.content[0]?.text?.trim() || '' };
}

// ── Fallback templates (no API key) ──────────────────────────
function fallbackMessage({ lead, business, channel, step }) {
  const firstName = lead.full_name?.split(' ')[0] || 'there';

  if (channel === 'sms') {
    const messages = [
      `Hi ${firstName}! ${business.name} here 👋 We got your consultation request! We'll reach out within 24h. Questions? Reply here. Reply STOP to opt out.`,
      `Hi ${firstName}, following up from ${business.name}! Still interested in your free consult? We have openings this week. Reply YES to book. Reply STOP to opt out.`,
      `Last reminder from ${business.name}: your free consultation is still available ${firstName}! Reply BOOK or call us. Reply STOP to opt out.`,
    ];
    return { body: messages[Math.min(step, messages.length - 1)] };
  }

  return {
    subject: `Your free consultation at ${business.name}`,
    body: `Hi ${firstName},\n\nThank you for your interest in ${business.name}! We'd love to schedule your free consultation.\n\nPlease reply to this email or call us to book your appointment.\n\nBest,\nSofia @ ${business.name}`,
  };
}

module.exports = { generateOutreach, generateReply };
