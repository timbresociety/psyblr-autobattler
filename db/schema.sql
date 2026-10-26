-- Shared hero store (U10, KTD9). Idempotent: safe to run on every cold start.
create table if not exists devices (
  id text primary key,
  created_at timestamptz not null default now()
);

-- A hero's look is shared and immutable once created; original_build is the creator's first gated build.
create table if not exists heroes (
  id text primary key,
  name text not null,
  name_lower text not null,
  creator_device text not null,
  photos jsonb not null default '[]',
  skills jsonb not null,
  original_build jsonb not null,
  use_count integer not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists heroes_name_lower on heroes (name_lower);

-- Each player's own build of a hero.
create table if not exists builds (
  id text primary key,
  hero_id text not null references heroes(id),
  device_id text not null,
  build jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists builds_device on builds (device_id);

-- Hero Forge: accounts and sign-in (KTD5)
create table if not exists accounts (
  id text primary key,
  email text not null,
  email_normalized text not null unique,
  created_ip text,
  created_at timestamptz not null default now()
);

-- single-use magic-link tokens, stored only as hashes
create table if not exists login_tokens (
  token_hash text primary key,
  email text not null,
  expires_at timestamptz not null,
  used_at timestamptz
);

-- sessions, stored only as hashes; expire after 30 days idle
create table if not exists sessions (
  id_hash text primary key,
  account_id text not null references accounts(id),
  device_id text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- durable abuse counters keyed by subject and time bucket (per IP, per email, global)
create table if not exists counters (
  key text not null,
  bucket text not null,
  count integer not null default 0,
  primary key (key, bucket)
);

-- Hero Forge: credits (KTD6). The ledger is the audit trail; credit_accounts.available is updated in the same
-- statement as each ledger row so holds are atomic under concurrency.
create table if not exists credit_accounts (
  account_id text primary key references accounts(id),
  available integer not null default 0 check (available >= 0)
);

create table if not exists credit_ledger (
  id text primary key,
  account_id text not null,
  kind text not null check (kind in ('grant', 'hold', 'release', 'charge', 'purchase')),
  amount integer not null check (amount >= 0),
  ref text not null,
  created_at timestamptz not null default now(),
  unique (kind, ref)
);
create index if not exists credit_ledger_account on credit_ledger (account_id);

-- Hero Forge: one row per forge session; `version` makes every advance a conditional update (KTD1).
create table if not exists forges (
  id text primary key,
  account_id text not null references accounts(id),
  device_id text,
  version integer not null,
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists forges_account on forges (account_id, updated_at desc);

-- Forged heroes on the Charter's heroes table (KTD9, KTD12). Production already has the table, so columns are
-- added in place; every statement here is safe to run again.
alter table heroes add column if not exists spec jsonb;
alter table heroes add column if not exists package_url text;
alter table heroes add column if not exists creator_account text;
