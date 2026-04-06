// supabase/seeds/med-spa.js
// ─────────────────────────────────────────────────────────────
// Seeds a sample Med Spa business + 3 test leads.
// Run: npm run seed
// ─────────────────────────────────────────────────────────────
'use strict';

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const supabase = require('../../config/supabase');

async function seed() {
  console.log('🌱 Seeding Med Spa business...\n');

  // ── Business ────────────────────────────────────────────────
  const businessId = uuidv4();
  const { error: bizErr } = await supabase.from('businesses').upsert({
    id:          businessId,
    name:        'Luxe Med Spa',
    niche:       'med_spa',
    slug:        'luxe-med-spa',
    owner_email: 'owner@luxemedspa.com',
    phone:       '+13055550001',
    city:        'Miami',
    state:       'FL',
    timezone:    'America/New_York',
    plan:        'starter',
    region:      'US',
  }, { onConflict: 'slug' });

  if (bizErr) { console.error('❌ Business seed failed:', bizErr.message); process.exit(1); }
  console.log(`✅ Business created: Luxe Med Spa (id: ${businessId})`);

  // ── Test leads ───────────────────────────────────────────────
  const leads = [
    { full_name: 'Amanda Torres',   email: 'amanda@example.com',  phone: '+13055550101', source: 'instagram',   sms_consent: true,  email_consent: true },
    { full_name: 'Jessica Morales', email: 'jessica@example.com', phone: '+13055550102', source: 'cold_email',  sms_consent: true,  email_consent: true },
    { full_name: 'Rachel Kim',      email: 'rachel@example.com',  phone: '+13055550103', source: 'organic',     sms_consent: false, email_consent: true },
  ].map(l => ({
    id:          uuidv4(),
    business_id: businessId,
    status:      'new',
    region:      'US',
    ...l,
  }));

  const { error: leadsErr } = await supabase.from('leads').upsert(leads, { onConflict: 'email,business_id' });
  if (leadsErr) { console.error('❌ Leads seed failed:', leadsErr.message); process.exit(1); }
  console.log(`✅ ${leads.length} test leads created`);

  // ── Suppression example ──────────────────────────────────────
  const { error: supErr } = await supabase.from('suppression_list').upsert([
    { contact: 'donotcontact@example.com', type: 'email', reason: 'manual', region: 'US' },
  ], { onConflict: 'contact' });
  if (supErr) { console.error('❌ Suppression seed failed:', supErr.message); }
  else console.log('✅ Suppression list example added');

  console.log('\n🎉 Seed complete!\n');
  console.log(`Business ID (save this): ${businessId}`);
}

seed().catch(err => {
  console.error('Fatal seed error:', err);
  process.exit(1);
});
