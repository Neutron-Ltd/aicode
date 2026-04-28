-- Optional cloud-provisioned workstation API key (nginx X-API-Key).
-- RLS unchanged: row owner can read/update; prefer Edge Function + extension sync for ergonomics.

begin;

alter table public.user_private_compute
  add column if not exists compute_api_key text;

comment on column public.user_private_compute.compute_api_key is
  'When set, extension may fetch via get-private-compute-credentials after sign-in and store in VS Code Secret Storage. Treat as sensitive; rotate if leaked.';

commit;
