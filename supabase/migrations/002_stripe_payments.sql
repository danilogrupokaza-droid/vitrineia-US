-- ─────────────────────────────────────────────────────────────────────────────
-- VitrineIA CA – Supabase Migration v002
-- Stripe payment flow: checkout sessions, subscriptions, invoices.
-- Run AFTER 001_initial_schema.sql.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Enum types ────────────────────────────────────────────────────────────────
create type payment_status as enum (
  'pending', 'paid', 'failed', 'refunded', 'disputed'
);

create type subscription_status as enum (
  'trialing', 'active', 'past_due', 'cancelled', 'unpaid'
);

-- ── payments ──────────────────────────────────────────────────────────────────
-- One row per Stripe Checkout Session (setup fee OR one-time charge).
create table payments (
  id                    uuid primary key default uuid_generate_v4(),
  business_id           uuid not null references businesses(id) on delete cascade,
  lead_id               uuid references leads(id) on delete set null,
  stripe_session_id     text unique,          -- cs_live_xxx
  stripe_payment_intent text,                 -- pi_xxx
  amount_cents          int not null,          -- setup fee in cents (e.g. 17900 = CA$179)
  currency              char(3) not null default 'cad',
  status                payment_status not null default 'pending',
  plan                  text not null default 'starter',
  region                char(2) not null default 'CA',
  paid_at               timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index idx_payments_business_id     on payments(business_id);
create index idx_payments_stripe_session  on payments(stripe_session_id);

-- ── subscriptions ─────────────────────────────────────────────────────────────
-- One row per active Stripe Subscription (monthly recurring).
create table subscriptions (
  id                       uuid primary key default uuid_generate_v4(),
  business_id              uuid not null references businesses(id) on delete cascade,
  stripe_subscription_id   text unique not null,   -- sub_xxx
  stripe_customer_id       text not null,           -- cus_xxx
  stripe_price_id          text not null,           -- price_xxx (monthly plan price)
  plan                     text not null default 'starter',
  status                   subscription_status not null default 'active',
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  cancel_at_period_end     boolean not null default false,
  cancelled_at             timestamptz,
  region                   char(2) not null default 'CA',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index idx_subscriptions_business_id  on subscriptions(business_id);
create index idx_subscriptions_stripe_sub   on subscriptions(stripe_subscription_id);
create index idx_subscriptions_customer     on subscriptions(stripe_customer_id);

-- ── Add stripe fields to businesses ───────────────────────────────────────────
alter table businesses
  add column if not exists stripe_customer_id    text,
  add column if not exists stripe_subscription_id text,
  add column if not exists billing_status         text not null default 'unpaid',
  add column if not exists plan_activated_at      timestamptz;

-- ── updated_at triggers ───────────────────────────────────────────────────────
create trigger trg_payments_updated_at before update on payments
  for each row execute function set_updated_at();

create trigger trg_subscriptions_updated_at before update on subscriptions
  for each row execute function set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table payments       enable row level security;
alter table subscriptions  enable row level security;
