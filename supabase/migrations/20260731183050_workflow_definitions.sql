create table public.workflows (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  version integer not null default 1 check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'archived')),
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  owner_id uuid not null references auth.users(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workflow_versions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  version integer not null check (version > 0),
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  status text not null check (status in ('draft', 'active', 'paused', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (workflow_id, version)
);

create index workflows_status_updated_idx on public.workflows(status, updated_at desc);
create index workflows_owner_updated_idx on public.workflows(owner_id, updated_at desc);
create index workflow_versions_workflow_version_idx on public.workflow_versions(workflow_id, version desc);

create or replace function private.normalize_workflow_definition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.owner_id = coalesce(new.owner_id, (select auth.uid()));
    new.created_by = coalesce(new.created_by, (select auth.uid()));
  else
    new.version = old.version + 1;
    new.updated_at = now();
  end if;

  new.definition = new.definition || jsonb_build_object(
    'id', new.id,
    'name', new.name,
    'description', new.description,
    'version', new.version,
    'status', new.status
  );
  if tg_op = 'UPDATE' then
    new.definition = new.definition || jsonb_build_object('updatedAt', new.updated_at);
  end if;
  return new;
end;
$$;

create or replace function private.capture_workflow_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workflow_versions (
    workflow_id,
    version,
    definition,
    status,
    created_by
  ) values (
    new.id,
    new.version,
    new.definition,
    new.status,
    coalesce((select auth.uid()), new.created_by)
  );
  return new;
end;
$$;

revoke all on function private.normalize_workflow_definition() from public;
revoke all on function private.capture_workflow_version() from public;

create trigger workflows_normalize before insert or update on public.workflows
for each row execute function private.normalize_workflow_definition();
create trigger workflows_version after insert or update on public.workflows
for each row execute function private.capture_workflow_version();
create trigger workflows_activity after insert or update or delete on public.workflows
for each row execute function private.capture_activity();
create trigger workflow_versions_activity after insert or delete on public.workflow_versions
for each row execute function private.capture_activity();

alter table public.workflows enable row level security;
alter table public.workflow_versions enable row level security;

create policy "active members read workflows" on public.workflows
for select to authenticated
using (exists (
  select 1 from public.operations_members m
  where m.user_id = (select auth.uid()) and m.active
));
create policy "operators create workflows" on public.workflows
for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and exists (
    select 1 from public.operations_members m
    where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')
  )
);
create policy "operators update workflows" on public.workflows
for update to authenticated
using (exists (
  select 1 from public.operations_members m
  where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')
))
with check (exists (
  select 1 from public.operations_members m
  where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')
));
create policy "operators delete workflows" on public.workflows
for delete to authenticated
using (exists (
  select 1 from public.operations_members m
  where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')
));

create policy "active members read workflow versions" on public.workflow_versions
for select to authenticated
using (exists (
  select 1 from public.operations_members m
  where m.user_id = (select auth.uid()) and m.active
));

grant select, insert, update, delete on public.workflows to authenticated;
grant select on public.workflow_versions to authenticated;
