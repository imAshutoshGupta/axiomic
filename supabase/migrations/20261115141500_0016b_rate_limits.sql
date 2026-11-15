-- Migration 0016b: rate_limits (counters for "too many tries"; Vercel keeps no memory).
-- Design: docs/DB-DESIGN.md 6.16. IPs here are personal data: kept 24 h at most.

create table public.rate_limits (
  bucket       text not null check (length(bucket) <= 200),  -- e.g. device_start:ip:203.0.113.7
  window_start timestamptz not null,
  count        integer not null default 0,
  primary key (bucket, window_start)
);

alter table public.rate_limits enable row level security;

create index rate_limits_window_idx on public.rate_limits (window_start);


-- Count one hit; refuse when over the limit for this time window.
create function private.hit_rate_limit(p_bucket text, p_window interval, p_max integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  insert into public.rate_limits (bucket, window_start, count)
  values (p_bucket, date_bin(p_window, now(), timestamptz '2000-01-01'), 1)
  on conflict (bucket, window_start)
    do update set count = public.rate_limits.count + 1
  returning count into n;

  if n > p_max then
    raise exception 'rate limited' using errcode = 'AX429';
  end if;
  return n;
end $$;

-- Who may call it is decided with the write functions (migration 0020).
revoke execute on function private.hit_rate_limit(text, interval, integer) from public, anon, authenticated, service_role;
