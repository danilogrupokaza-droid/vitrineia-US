-- ─────────────────────────────────────────────────────────────────────────────
-- VitrineIA US – Supabase Migration v001
-- Run this in the Supabase SQL Editor of the US project ONLY.
-- This schema is intentionally separate from any BR project.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Extensions ───────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm"; -- for fuzzy search on names/emails

-- ── Enum types ────────────────────────────────────────────────────────────────
create type lead_status as enum (
  'new', 'contacted', 'qualified', 'booked', 'lost', 'unsubscribed'
);

create type lead_source as enum (
  'instagram', 'cold_email', 'referral', 'organic', 'paid', 'other'
);

create type sequence_status as enum (
  'active', 'paused', 'completed', 'cancelled'
);

create type booking_status as enum (
  'pending', 'confirmed', 'cancelled', 'no_show', 'completed'
);

-- ── businesses ────────────────────────────────────────────────────────────────
-- One row per client business (e.g. "Luxe Med Spa – Miami").
create table businesses (
  id           uuid primary key default uuid_generate_v4(),
  name         text not null,
  niche        text not null default 'med_spa',  -- med_spa | barber | dental | realtor
  slug         text not null unique,             -- used in landing page URLs
  owner_email  text not null,
  phone        text,
  website      text,
  address      text,
  city         text,
  state        char(2),                          -- US state abbreviation
  timezone     text not null default 'America/New_York',
  plan         text not null default 'starter',  -- starter | growth | full
  active       boolean not null default true,
  region       char(2) not null default 'US',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── leads ─────────────────────────────────────────────────────────────────────
create table leads (
  id             uuid primary key default uuid_generate_v4(),
  business_id    uuid not null references businesses(id) on delete cascade,
  full_name      text not null,
  email          text not null,
  phone          text,                           -- E.164 format: +1XXXXXXXXXX
  source         lead_source not null default 'other',
  status         lead_status not null default 'new',
  notes          text,
  -- TCPA compliance (required for US SMS marketing)
  sms_consent    boolean not null default false,
  email_consent  boolean not null default false,
  opted_out_at   timestamptz,                    -- set when lead unsubscribes
  region         char(2) not null default 'US',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- Prevent duplicate leads per business
  unique (email, business_id)
);

create index idx_leads_business_id on leads(business_id);
create index idx_leads_status      on leads(status);
create index idx_leads_email_trgm  on leads using gin(email gin_trgm_ops);

-- ── sequences ─────────────────────────────────────────────────────────────────
-- A sequence is the follow-up automation assigned to a lead.
create table sequences (
  id           uuid primary key default uuid_generate_v4(),
  lead_id      uuid not null references leads(id) on delete cascade,
  business_id  uuid not null references businesses(id) on delete cascade,
  template     text not null default 'med_spa_starter',
  status       sequence_status not null default 'active',
  current_step int not null default 0,
  next_run_at  timestamptz,
  started_at   timestamptz not null default now(),
  completed_at timestamptz,
  region       char(2) not null default 'US',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index idx_sequences_lead_id    on sequences(lead_id);
create index idx_sequences_next_run   on sequences(next_run_at) where status = 'active';

-- ── sequence_events ───────────────────────────────────────────────────────────
-- Logs every email/SMS step that was sent.
create table sequence_events (
  id           uuid primary key default uuid_generate_v4(),
  sequence_id  uuid not null references sequences(id) on delete cascade,
  step         int not null,
  channel      text not null,                    -- 'email' | 'sms'
  sent_at      timestamptz not null default now(),
  status       text not null default 'sent',     -- sent | delivered | bounced | failed
  provider_id  text,                             -- Twilio SID or Resend message ID
  region       char(2) not null default 'US'
);

-- ── bookings ──────────────────────────────────────────────────────────────────
create table bookings (
  id            uuid primary key default uuid_generate_v4(),
  lead_id       uuid not null references leads(id) on delete cascade,
  business_id   uuid not null references businesses(id) on delete cascade,
  scheduled_at  timestamptz not null,
  duration_min  int not null default 30,
  status        booking_status not null default 'pending',
  notes         text,
  source        text default 'landing_page',     -- how the booking was made
  region        char(2) not null default 'US',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_bookings_lead_id      on bookings(lead_id);
create index idx_bookings_business_id  on bookings(business_id);
create index idx_bookings_scheduled_at on bookings(scheduled_at);

-- ── suppression_list ──────────────────────────────────────────────────────────
-- Hard opt-outs. No email or SMS must ever go to these.
create table suppression_list (
  id          uuid primary key default uuid_generate_v4(),
  contact     text not null unique,              -- email or phone (E.164)
  type        text not null,                     -- 'email' | 'sms'
  reason      text not null default 'unsubscribe', -- unsubscribe | bounce | spam | manual
  created_at  timestamptz not null default now(),
  region      char(2) not null default 'US'
);

create index idx_suppression_contact on suppression_list(contact);

-- ── audit_log ─────────────────────────────────────────────────────────────────
create table audit_log (
  id          bigserial primary key,
  table_name  text not null,
  record_id   text not null,
  action      text not null,                    -- INSERT | UPDATE | STATUS_CHANGE | DELETE
  payload     jsonb,
  created_at  timestamptz not null default now(),
  region      char(2) not null default 'US'
);

create index idx_audit_log_record on audit_log(table_name, record_id);

-- ── updated_at trigger ────────────────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_businesses_updated_at before update on businesses
  for each row execute function set_updated_at();

create trigger trg_leads_updated_at before update on leads
  for each row execute function set_updated_at();

create trigger trg_sequences_updated_at before update on sequences
  for each row execute function set_updated_at();

create trigger trg_bookings_updated_at before update on bookings
  for each row execute function set_updated_at();

-- ── Row Level Security ────────────────────────────────────────────────────────
-- Enable RLS on all tables (service key bypasses RLS server-side).
alter table businesses       enable row level security;
alter table leads            enable row level security;
alter table sequences        enable row level security;
alter table sequence_events  enable row level security;
alter table bookings         enable row level security;
alter table suppression_list enable row level security;
alter table audit_log        enable row level security;

-- Block all anon/public access — only the service role (backend) can read/write.
-- Add specific policies here when you expose a client-side Supabase connection.
