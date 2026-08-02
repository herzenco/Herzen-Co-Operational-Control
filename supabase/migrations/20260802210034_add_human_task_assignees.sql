create table public.operations_profiles (
  user_id uuid primary key references public.operations_members(user_id) on delete cascade,
  display_name text not null,
  profile_type text not null default 'human' check (profile_type = 'human'),
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.operations_profiles (user_id, display_name, active)
select user_id, display_name, active
from public.operations_members
on conflict (user_id) do update
set display_name = excluded.display_name,
    active = excluded.active,
    updated_at = now();

alter table public.tasks
  add column assigned_user_id uuid references public.operations_profiles(user_id) on delete set null,
  add constraint tasks_single_assignee check (num_nonnulls(owner_agent_id, assigned_user_id) <= 1);

create index tasks_assigned_user_status_idx
  on public.tasks(assigned_user_id, status)
  where assigned_user_id is not null;

alter table public.operations_profiles enable row level security;

create policy "active members read human profiles"
on public.operations_profiles for select to authenticated
using (
  exists (
    select 1 from public.operations_members member
    where member.user_id = (select auth.uid()) and member.active
  )
);

create policy "operators manage human profiles"
on public.operations_profiles for all to authenticated
using (
  exists (
    select 1 from public.operations_members member
    where member.user_id = (select auth.uid())
      and member.active
      and member.role in ('owner', 'operator')
  )
)
with check (
  exists (
    select 1 from public.operations_members member
    where member.user_id = (select auth.uid())
      and member.active
      and member.role in ('owner', 'operator')
  )
);

grant select, insert, update, delete on public.operations_profiles to authenticated;

comment on table public.operations_profiles is
  'Public-safe human assignment directory for OCC members; authorization remains in operations_members.';
comment on column public.tasks.assigned_user_id is
  'Human ticket assignee, mutually exclusive with owner_agent_id.';
