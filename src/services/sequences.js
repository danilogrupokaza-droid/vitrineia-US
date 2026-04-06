// src/services/sequences.js
// ─────────────────────────────────────────────────────────────
// Follow-up sequence templates per niche.
// Each step has: delay (minutes after previous), channel, body.
// ─────────────────────────────────────────────────────────────
'use strict';

const SEQUENCES = {

  // ── Med Spa · Starter (3-step SMS) ───────────────────────────
  med_spa_starter: [
    {
      step: 0,
      channel: 'sms',
      delay_minutes: 2, // send ~2 min after form submit
      body: (lead, business) =>
        `Hi ${lead.first_name}! This is ${business.name} 👋 We received your consultation request and will reach out within 24h. Questions? Reply here anytime. Reply STOP to opt out.`,
    },
    {
      step: 1,
      channel: 'sms',
      delay_minutes: 60 * 24, // 24h later
      body: (lead, business) =>
        `Hi ${lead.first_name}, just following up from ${business.name}! Have you had a chance to think about your free consultation? We have openings this week. Reply YES to book or call us anytime. Reply STOP to opt out.`,
    },
    {
      step: 2,
      channel: 'sms',
      delay_minutes: 60 * 24 * 3, // 3 days later
      body: (lead, business) =>
        `Last reminder from ${business.name}: your free consultation offer is still available! Book now and let's find the right treatment for you. Reply STOP to opt out.`,
    },
  ],

  // ── Med Spa · Growth (5-step SMS + email) ────────────────────
  med_spa_growth: [
    {
      step: 0,
      channel: 'sms',
      delay_minutes: 2,
      body: (lead, business) =>
        `Hi ${lead.first_name}! ${business.name} here. Thanks for reaching out — we'll contact you within 24h to schedule your free consult. Reply STOP to opt out.`,
    },
    {
      step: 1,
      channel: 'sms',
      delay_minutes: 60 * 4, // 4h later
      body: (lead, business) =>
        `Hi ${lead.first_name}, just a quick note from ${business.name}. Did you know we offer same-week appointments? Let us know when works for you! Reply STOP to opt out.`,
    },
    {
      step: 2,
      channel: 'sms',
      delay_minutes: 60 * 24, // 24h later
      body: (lead, business) =>
        `${lead.first_name}, we'd love to meet you at ${business.name}! Your free consultation is still waiting. Any questions before booking? Just reply here. Reply STOP to opt out.`,
    },
    {
      step: 3,
      channel: 'sms',
      delay_minutes: 60 * 24 * 3,
      body: (lead, business) =>
        `Hi ${lead.first_name}! ${business.name} checking in one last time. Our specialists are ready to help you look and feel your best. Book your free consult this week! Reply STOP to opt out.`,
    },
    {
      step: 4,
      channel: 'sms',
      delay_minutes: 60 * 24 * 7,
      body: (lead, business) =>
        `${lead.first_name}, this is your final reminder from ${business.name}. Free consultation available — no commitment, just honest advice. Reply BOOK or call us. Reply STOP to opt out.`,
    },
  ],
};

/**
 * Get the sequence template for a given plan.
 * Falls back to starter if plan not found.
 */
function getTemplate(niche = 'med_spa', plan = 'starter') {
  const key = `${niche}_${plan}`;
  return SEQUENCES[key] || SEQUENCES['med_spa_starter'];
}

module.exports = { SEQUENCES, getTemplate };
