// src/utils/suppression.js
// ─────────────────────────────────────────────────────────────
// Always call isSuppressed() before sending any email or SMS.
// This is a hard compliance gate – never bypass it.
// ─────────────────────────────────────────────────────────────
'use strict';

const supabase = require('../../config/supabase');

/**
 * Returns true if the contact (email or phone) is on the suppression list.
 * @param {string} contact – email address or E.164 phone number
 */
async function isSuppressed(contact) {
  const { data, error } = await supabase
    .from('suppression_list')
    .select('id')
    .eq('contact', contact.toLowerCase().trim())
    .eq('region', 'US')
    .maybeSingle();

  if (error) {
    // Fail safe: if we can't check, we suppress.
    console.error('[suppression] DB error – defaulting to suppressed:', error.message);
    return true;
  }

  return !!data;
}

/**
 * Adds a contact to the suppression list.
 * Call this on unsubscribe, bounce, or spam complaint.
 * @param {string} contact – email address or E.164 phone number
 * @param {'email'|'sms'} type
 * @param {'unsubscribe'|'bounce'|'spam'|'manual'} reason
 */
async function suppress(contact, type, reason = 'unsubscribe') {
  const { error } = await supabase.from('suppression_list').upsert({
    contact: contact.toLowerCase().trim(),
    type,
    reason,
    region: 'US',
  }, { onConflict: 'contact' });

  if (error) {
    console.error('[suppression] Failed to add to suppression list:', error.message);
    throw error;
  }

  console.log(`[suppression] Added ${contact} (${type} / ${reason})`);
}

module.exports = { isSuppressed, suppress };
