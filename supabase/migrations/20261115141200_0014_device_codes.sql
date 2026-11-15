-- Migration 0014: device_codes (the "type this code in your browser" CLI login).
-- Design: docs/DB-DESIGN.md 6.15. Invisible to browsers (no policies, ever).

create table public.device_codes (
  id               uuid primary key default gen_random_uuid(),
  user_code        text not null unique check (user_code ~ '^[A-Z0-9]{8}$'),  -- shown as ABCD-1234
  device_code_hash bytea not null unique check (octet_length(device_code_hash) = 32),
  client_info      text check (length(client_info) <= 120),  -- built by the server, never by the CLI
  attempts         smallint not null default 0,
  approved_by      uuid references public.profiles (id) on delete set null,
  approved_at      timestamptz,
  consumed_at      timestamptz,                                -- single use
  token_id         uuid references public.api_tokens (id) on delete cascade,
  expires_at       timestamptz not null default now() + interval '10 minutes',
  created_at       timestamptz not null default now()
);

alter table public.device_codes enable row level security;

create index device_codes_approved_by_idx on public.device_codes (approved_by);
create index device_codes_token_idx       on public.device_codes (token_id);
create index device_codes_expires_idx     on public.device_codes (expires_at);
