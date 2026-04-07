// src/agents/yasmin.js
// ─────────────────────────────────────────────────────────────
// Yasmin US – Operations agent.
// Responsibilities: client onboarding, asset collection,
// booking confirmations, admin follow-up, upsell identification.
// ─────────────────────────────────────────────────────────────
'use strict';

const Anthropic = require('@anthropic-ai/sdk');

function getClient() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key === 'your_anthropic_key_here') return null;
  return new Anthropic({ apiKey: key });
}

// ── Yasmin's system prompt ────────────────────────────────────
const YASMIN_SYSTEM = `You are Yasmin, a warm and organized operations coordinator for NovuLeads, serving local barbershops in Canada.

Your role:
- Send onboarding emails to new clients after they book
- Collect necessary information before appointments (preferences, style references)
- Send appointment confirmations and reminders
- Follow up after appointments to check satisfaction
- Identify upsell opportunities and flag them for the sales team (Sofia)
- Handle administrative requests and booking changes

Tone: organized, friendly, efficient. Like the person at the front desk who remembers your name and your usual cut.

Rules:
- Always be clear about what you need from the client
- Keep emails well-structured with clear next steps
- For SMS, keep under 160 characters and always include opt-out
- Flag any upsell opportunity with [UPSELL OPPORTUNITY] tag for Sofia
- Sign off as "Yasmin @ [Business Name]"
- You are operating in Canada — references to compliance should respect CASL, not TCPA`;

/**
 * Generate an onboarding email for a newly booked client.
 */
async function generateOnboarding({ lead, business, booking }) {
  const client = getClient();
  if (!client) {
    return fallbackOnboarding({ lead, business, booking });
  }

  const firstName = lead.full_name?.split(' ')[0] || 'there';
  const apptDate  = booking?.scheduled_at
    ? new Date(booking.scheduled_at).toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : 'your upcoming appointment';

  const prompt = `
Business: ${business.name} in ${business.city}, ${business.state}
Client name: ${firstName}
Appointment: ${apptDate}
Interest: ${lead.notes?.replace('Interest: ', '') || 'general consultation'}

Write a warm onboarding email confirming their appointment.
Include:
1. Confirmation of date/time
2. What to expect at the consultation
3. What to bring (ID, arrive 10 min early)
4. How to reschedule (reply to email)
5. Excitement about meeting them

Subject line on first line: Subject: [subject]
  `.trim();

  const message = await client.messages.create({
    model:      'claude-sonnet-4-5-20251022',
    max_tokens: 500,
    system:     YASMIN_SYSTEM,
    messages:   [{ role: 'user', content: prompt }],
  });

  const text    = message.content[0]?.text || '';
  const lines   = text.split('\n');
  const subjLine = lines.find(l => l.startsWith('Subject:'));
  const subject  = subjLine ? subjLine.replace('Subject:', '').trim() : `Your appointment at ${business.name} is confirmed!`;
  const body     = lines.filter(l => !l.startsWith('Subject:')).join('\n').trim();

  return { subject, body };
}

/**
 * Generate a booking reminder (24h before appointment).
 */
async function generateReminder({ lead, business, booking, channel = 'sms' }) {
  const client = getClient();
  const firstName = lead.full_name?.split(' ')[0] || 'there';
  const apptDate  = booking?.scheduled_at
    ? new Date(booking.scheduled_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    : 'tomorrow';

  if (!client) {
    if (channel === 'sms') {
      return { body: `Hi ${firstName}! Reminder: your free consult at ${business.name} is ${apptDate} tomorrow. Reply C to confirm or STOP to opt out.` };
    }
    return {
      subject: `Reminder: Your appointment tomorrow at ${business.name}`,
      body: `Hi ${firstName},\n\nJust a reminder about your consultation tomorrow at ${apptDate}.\n\nSee you soon!\nYasmin @ ${business.name}`,
    };
  }

  const prompt = `
Business: ${business.name}
Client: ${firstName}
Appointment time: ${apptDate} tomorrow
Channel: ${channel}

Write a friendly appointment reminder.
${channel === 'sms' ? 'Max 160 chars. Ask them to reply C to confirm. Include Reply STOP to opt out.' : 'Include subject line: Subject: [subject]'}
  `.trim();

  const message = await client.messages.create({
    model:      'claude-sonnet-4-5-20251022',
    max_tokens: 200,
    system:     YASMIN_SYSTEM,
    messages:   [{ role: 'user', content: prompt }],
  });

  const text = message.content[0]?.text?.trim() || '';

  if (channel === 'sms') return { body: text };

  const lines    = text.split('\n');
  const subjLine = lines.find(l => l.startsWith('Subject:'));
  const subject  = subjLine ? subjLine.replace('Subject:', '').trim() : `Reminder: Your appointment tomorrow`;
  const body     = lines.filter(l => !l.startsWith('Subject:')).join('\n').trim();
  return { subject, body };
}

/**
 * Scan a conversation or note for upsell opportunities.
 * Returns null if no opportunity found, or a description if found.
 */
async function scanForUpsell({ lead, business, notes }) {
  const client = getClient();
  if (!client) return null;

  const prompt = `
Business: ${business.name} (${business.niche?.replace('_', ' ')})
Current plan: ${business.plan}
Client notes: "${notes}"

Is there a clear upsell opportunity here? 
Reply with either:
- "NO_UPSELL" if there's no clear opportunity
- A single sentence describing the upsell opportunity if there is one
  `.trim();

  const message = await client.messages.create({
    model:      'claude-sonnet-4-5-20251022',
    max_tokens: 100,
    system:     YASMIN_SYSTEM,
    messages:   [{ role: 'user', content: prompt }],
  });

  const result = message.content[0]?.text?.trim();
  return result === 'NO_UPSELL' ? null : result;
}

// ── Fallback templates ────────────────────────────────────────
function fallbackOnboarding({ lead, business, booking }) {
  const firstName = lead.full_name?.split(' ')[0] || 'there';
  return {
    subject: `You're booked at ${business.name}! Here's what's next`,
    body: `Hi ${firstName},

Great news — your free consultation at ${business.name} is confirmed!

Here's what to expect:
• Arrive 10 minutes early
• Bring a valid photo ID
• Wear comfortable clothing
• Come with any questions you have about treatments

Need to reschedule? Just reply to this email.

We can't wait to meet you!

Yasmin @ ${business.name}`,
  };
}

module.exports = { generateOnboarding, generateReminder, scanForUpsell };
