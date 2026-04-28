-- Per-user private compute endpoint host (and default model) for Build Ultra Workstation mode.
-- Extension reads with user JWT (RLS). API keys stay in VS Code Secret Storage.

begin;

create table if not exists public.user_private_compute (
  id uuid primary key references auth.users (id) on delete cascade,
  compute_host text,
  default_model text,
  updated_at timestamptz not null default now()
);

comment on table public.user_private_compute is
  'Account-linked compute host for Workstation mode; extension merges with local settings override.';

create index if not exists idx_user_private_compute_id on public.user_private_compute (id);

alter table public.user_private_compute enable row level security;
alter table public.user_private_compute force row level security;

drop policy if exists user_private_compute_select_own on public.user_private_compute;
create policy user_private_compute_select_own
  on public.user_private_compute
  for select
  to authenticated
  using (id = auth.uid());

drop policy if exists user_private_compute_insert_own on public.user_private_compute;
create policy user_private_compute_insert_own
  on public.user_private_compute
  for insert
  to authenticated
  with check (id = auth.uid());

drop policy if exists user_private_compute_update_own on public.user_private_compute;
create policy user_private_compute_update_own
  on public.user_private_compute
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Provision row on signup (security definer; same pattern as user_quotas).
create or replace function public.handle_new_user_private_compute()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_private_compute (id, compute_host, default_model)
  values (new.id, null, null)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_private_compute on auth.users;
create trigger on_auth_user_created_private_compute
  after insert on auth.users
  for each row
  execute function public.handle_new_user_private_compute();

-- Backfill existing users.
insert into public.user_private_compute (id, compute_host, default_model)
select u.id, null, null
from auth.users u
where not exists (
  select 1 from public.user_private_compute p where p.id = u.id
);

commit;
