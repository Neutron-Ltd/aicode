begin;

-- Monthly refill scheduling (Stripe subscription period end or manual webhook sync).
alter table public.user_quotas
  add column if not exists next_token_refill_at timestamptz;

comment on column public.user_quotas.next_token_refill_at is
  'Next scheduled token allowance reset (e.g. subscription period boundary).';

-- DB-backed chat rate limiting (updated from Edge using service role; users do not read this).
create table if not exists public.chat_rate_counters (
  user_id uuid primary key references auth.users (id) on delete cascade,
  minute_bucket text not null,
  request_count int not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.chat_rate_counters enable row level security;
alter table public.chat_rate_counters force row level security;

-- Authenticated clients cannot access rate rows; service_role bypasses RLS.
drop policy if exists chat_rate_deny_all on public.chat_rate_counters;
create policy chat_rate_deny_all on public.chat_rate_counters
  for all
  to authenticated
  using (false)
  with check (false);

-- Allow signed-in users to read catalog master prompts (non-secret templates).
drop policy if exists master_prompts_select_authenticated on public.master_prompts;
create policy master_prompts_select_authenticated
  on public.master_prompts
  for select
  to authenticated
  using (true);

commit;
