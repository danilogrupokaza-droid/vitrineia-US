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

  // ── Barbershop · Starter (3-step SMS) ────────────────────────
  barber_starter: [
    {
      step: 0,
      channel: 'sms',
      delay_minutes: 2,
      body: (lead, business) =>
        `Hey ${lead.first_name}! ${business.name} here 💈 Got your booking request — we'll confirm your spot within 2h. Questions? Just reply. Reply STOP to opt out.`,
    },
    {
      step: 1,
      channel: 'sms',
      delay_minutes: 60 * 24, // 24h later
      body: (lead, business) =>
        `Hey ${lead.first_name}, following up from ${business.name}! Still need a cut? We have openings this week. Reply YES to book your spot. Reply STOP to opt out.`,
    },
    {
      step: 2,
      channel: 'sms',
      delay_minutes: 60 * 24 * 3, // 3 days later
      body: (lead, business) =>
        `Last one from ${business.name}: your spot is still open, ${lead.first_name}! Book before the week fills up. Reply BOOK or just drop in. Reply STOP to opt out.`,
    },
  ],

  // ── Barbershop · Growth (5-step SMS + email) ──────────────────
  barber_growth: [
    {
      step: 0,
      channel: 'sms',
      delay_minutes: 2,
      body: (lead, business) =>
        `Hey ${lead.first_name}! ${business.name} here 💈 Thanks for reaching out — we'll confirm your booking within 2h. Any style preferences? Just reply. Reply STOP to opt out.`,
    },
    {
      step: 1,
      channel: 'sms',
      delay_minutes: 60 * 4, // 4h later
      body: (lead, business) =>
        `Hey ${lead.first_name}, ${business.name} here — we have same-week availability! Let us know what day works best for you. Reply STOP to opt out.`,
    },
    {
      step: 2,
      channel: 'email',
      delay_minutes: 60 * 24, // 24h later
      subject: (lead, business) => `Your spot at ${business.name} is waiting, ${lead.first_name}`,
      body: (lead, business) =>
        `Hey ${lead.first_name},\n\nWe noticed you haven't booked yet — no worries, your spot is still available at ${business.name}.\n\nWe specialize in clean fades, precise lineups, and making sure you walk out looking sharp. First visit? We'll make sure you're comfortable from start to finish.\n\nReply to this email or click the link below to lock in your appointment:\n${business.booking_url || 'Reply to this email and we\'ll sort it out.'}\n\nSee you soon,\nSofia @ ${business.name}`,
    },
    {
      step: 3,
      channel: 'sms',
      delay_minutes: 60 * 24 * 3, // 3 days later
      body: (lead, business) =>
        `${lead.first_name}, ${business.name} checking in one more time! Spots this week are filling fast. Reply YES to grab yours. Reply STOP to opt out.`,
    },
    {
      step: 4,
      channel: 'sms',
      delay_minutes: 60 * 24 * 7, // 7 days later
      body: (lead, business) =>
        `Last reminder from ${business.name}, ${lead.first_name}. Your first cut — on us if you book this week. Reply BOOK to claim it. Reply STOP to opt out.`,
    },
  ],

  // ── Barbershop · Full (6-step: SMS + email + re-engagement) ──
  barber_full: [
    {
      step: 0,
      channel: 'sms',
      delay_minutes: 2,
      body: (lead, business) =>
        `Hey ${lead.first_name}! ${business.name} here 💈 Got your request. Confirming your spot now — we'll text you back in under 2h. Reply STOP to opt out.`,
    },
    {
      step: 1,
      channel: 'sms',
      delay_minutes: 60 * 2, // 2h later
      body: (lead, business) =>
        `${lead.first_name}, your spot is ready at ${business.name}! Pick a time that works: ${business.booking_url || 'reply here and we\'ll sort it'}. Reply STOP to opt out.`,
    },
    {
      step: 2,
      channel: 'email',
      delay_minutes: 60 * 24, // 24h later
      subject: (lead, business) => `Still thinking? Here's what to expect at ${business.name}`,
      body: (lead, business) =>
        `Hey ${lead.first_name},\n\nWanted to give you a proper intro to ${business.name}.\n\nHere's what your first visit looks like:\n• Walk in or book online — we're flexible\n• Consultation before we start — no surprises\n• Clean fade, precise lineup, or whatever your style calls for\n• Hot towel finish on every cut\n\nFirst-timers get priority booking. Just reply to this email or use the link below:\n${business.booking_url || 'Reply and we\'ll lock in your slot.'}\n\nLooking forward to it,\nSofia @ ${business.name}`,
    },
    {
      step: 3,
      channel: 'sms',
      delay_minutes: 60 * 24 * 3,
      body: (lead, business) =>
        `${lead.first_name}, still haven't seen you at ${business.name}! Spots are going fast this week — reply YES and we'll hold one for you. Reply STOP to opt out.`,
    },
    {
      step: 4,
      channel: 'email',
      delay_minutes: 60 * 24 * 5,
      subject: (lead, business) => `One last thing, ${lead.first_name}`,
      body: (lead, business) =>
        `Hey ${lead.first_name},\n\nThis is our last follow-up — we don't want to clog your inbox.\n\nIf you're still looking for a solid barber in the area, ${business.name} is here. No hard sell — just good cuts and a relaxed vibe.\n\nBook whenever you're ready: ${business.booking_url || 'reply to this email.'}\n\nTake care,\nSofia @ ${business.name}`,
    },
    {
      step: 5,
      channel: 'sms',
      delay_minutes: 60 * 24 * 14, // 2 weeks re-engagement
      body: (lead, business) =>
        `Hey ${lead.first_name}! It's been a while — ${business.name} has new availability. Ready for a fresh cut? Reply BOOK to grab a spot. Reply STOP to opt out.`,
    },
  ],
};

/**
 * Get the sequence template for a given plan.
 * Falls back to niche-specific starter, then generic starter.
 */
function getTemplate(niche = 'barber', plan = 'starter') {
  const key = `${niche}_${plan}`;
  if (SEQUENCES[key]) return SEQUENCES[key];

  // Try niche starter before falling back to med_spa
  const nicheStarter = `${niche}_starter`;
  if (SEQUENCES[nicheStarter]) return SEQUENCES[nicheStarter];

  return SEQUENCES['med_spa_starter'];
}

module.exports = { SEQUENCES, getTemplate };
