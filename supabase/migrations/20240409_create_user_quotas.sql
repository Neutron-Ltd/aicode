-- user_quotas: per-user token accounting for Mirror chat
begin;

create table if not exists public.user_quotas (
  id uuid primary key references auth.users (id) on delete cascade,
  tokens_used integer not null default 0,
  total_quota integer not null default 150000,
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_quotas_id on public.user_quotas (id);

alter table public.user_quotas enable row level security;
alter table public.user_quotas force row level security;

drop policy if exists user_quotas_select_own on public.user_quotas;
create policy user_quotas_select_own
  on public.user_quotas
  for select
  to authenticated
  using (id = auth.uid());

-- Edge Function deducts usage with the caller's JWT — required alongside SELECT.
drop policy if exists user_quotas_update_own on public.user_quotas;
create policy user_quotas_update_own
  on public.user_quotas
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- New signups: provision quota row (security definer so RLS does not block insert).
create or replace function public.handle_new_user_quotas()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_quotas (id, tokens_used, total_quota)
  values (new.id, 0, 150000)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_quotas on auth.users;
create trigger on_auth_user_created_quotas
  after insert on auth.users
  for each row
  execute function public.handle_new_user_quotas();

-- Existing users (one-time backfill for testing).
insert into public.user_quotas (id, tokens_used, total_quota)
select u.id, 0, 150000
from auth.users u
where not exists (
  select 1 from public.user_quotas q where q.id = u.id
);

commit;
