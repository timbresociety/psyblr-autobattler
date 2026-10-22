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
