begin;

-- gen_random_uuid() requires pgcrypto (already ensured in 20240101_init_vector.sql).

-- Master prompts: no RLS policies yet (deny authenticated access until you add policies or use service role).
create table if not exists public.master_prompts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  content text not null,
  version integer not null default 1
);

alter table public.master_prompts enable row level security;
alter table public.master_prompts force row level security;

comment on table public.master_prompts is
  'Master prompt templates. RLS on with no policies — grant access via Edge/service role or add policies.';

-- Stripe / billing: tier and structured entitlements on existing quota rows.
alter table public.user_quotas
  add column if not exists tier text not null default 'free',
  add column if not exists entitlements jsonb not null default '{}'::jsonb;

comment on column public.user_quotas.tier is 'Product tier label (e.g. free, pro).';
comment on column public.user_quotas.entitlements is 'JSON bag for feature flags or limits from billing.';

-- New signups: include tier/entitlements defaults.
create or replace function public.handle_new_user_quotas()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_quotas (id, tokens_used, total_quota, tier, entitlements)
  values (new.id, 0, 150000, 'free', '{}'::jsonb)
  on conflict (id) do nothing;
  return new;
end;
$$;

commit;
