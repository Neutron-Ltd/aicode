begin;

-- UUID defaults for primary keys
create extension if not exists pgcrypto;

-- pgvector for semantic search
create extension if not exists vector;

create table if not exists public.workspace_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  file_path text not null,
  content text not null,
  embedding vector(1536) not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_workspace_documents_user_id
  on public.workspace_documents (user_id);

-- Optional ANN index; tune lists based on dataset size.
create index if not exists idx_workspace_documents_embedding_ivfflat
  on public.workspace_documents
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

alter table public.workspace_documents enable row level security;
alter table public.workspace_documents force row level security;

drop policy if exists workspace_documents_select_own on public.workspace_documents;
create policy workspace_documents_select_own
  on public.workspace_documents
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists workspace_documents_insert_own on public.workspace_documents;
create policy workspace_documents_insert_own
  on public.workspace_documents
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists workspace_documents_update_own on public.workspace_documents;
create policy workspace_documents_update_own
  on public.workspace_documents
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists workspace_documents_delete_own on public.workspace_documents;
create policy workspace_documents_delete_own
  on public.workspace_documents
  for delete
  to authenticated
  using (user_id = auth.uid());

create or replace function public.match_documents(
  query_embedding vector(1536),
  match_threshold float4,
  match_count int default 5
)
returns table (
  id uuid,
  file_path text,
  content text,
  similarity float4
)
language sql
stable
security invoker
as $$
  select
    d.id,
    d.file_path,
    d.content,
    (1 - (d.embedding <=> query_embedding))::float4 as similarity
  from public.workspace_documents d
  where
    d.user_id = auth.uid()
    and (1 - (d.embedding <=> query_embedding)) >= match_threshold
  order by similarity desc
  limit greatest(match_count, 1);
$$;

revoke all on function public.match_documents(vector, float4, int) from public;
grant execute on function public.match_documents(vector, float4, int) to authenticated;

commit;
