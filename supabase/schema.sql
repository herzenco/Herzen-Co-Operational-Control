create extension if not exists pgcrypto;
create schema if not exists private;

create table public.operations_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('owner', 'operator', 'agent', 'viewer')),
  active boolean not null default true,
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  role text not null,
  lane text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'retired')),
  charter text,
  instructions text,
  capabilities jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  reports_to uuid references public.agents(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  status text not null default 'active' check (status in ('planned', 'active', 'paused', 'completed', 'archived')),
  owner_agent_id uuid references public.agents(id) on delete set null,
  objectives jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  project_id uuid references public.projects(id) on delete set null,
  owner_agent_id uuid references public.agents(id) on delete set null,
  status text not null default 'inbox' check (status in ('inbox', 'in_progress', 'blocked', 'review', 'done', 'cancelled')),
  priority text not null default 'medium' check (priority in ('urgent', 'high', 'medium', 'low')),
  due_at timestamptz,
  definition_of_done text,
  dependencies jsonb not null default '[]'::jsonb,
  tags text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.work_logs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  entry_type text not null default 'progress' check (entry_type in ('note', 'progress', 'decision', 'blocker', 'deliverable', 'evidence')),
  title text,
  body text not null,
  artifacts jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.daily_updates (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  update_date date not null default current_date,
  summary text not null,
  completed jsonb not null default '[]'::jsonb,
  blockers jsonb not null default '[]'::jsonb,
  next_steps jsonb not null default '[]'::jsonb,
  asks jsonb not null default '[]'::jsonb,
  health text not null default 'on_track' check (health in ('on_track', 'at_risk', 'blocked')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_id, update_date)
);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  requested_by_agent_id uuid references public.agents(id) on delete set null,
  reviewer_agent_id uuid references public.agents(id) on delete set null,
  title text not null,
  summary text not null,
  evidence jsonb not null default '[]'::jsonb,
  risk text,
  recommendation text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'changes_requested', 'declined', 'withdrawn')),
  decision_note text,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  due_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.activity_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index agents_status_idx on public.agents(status);
create index agents_auth_user_idx on public.agents(auth_user_id) where auth_user_id is not null;
create index agents_reports_to_idx on public.agents(reports_to) where reports_to is not null;
create index agents_created_by_idx on public.agents(created_by) where created_by is not null;
create index projects_status_idx on public.projects(status);
create index projects_owner_agent_idx on public.projects(owner_agent_id) where owner_agent_id is not null;
create index projects_created_by_idx on public.projects(created_by) where created_by is not null;
create index tasks_status_due_idx on public.tasks(status, due_at);
create index tasks_owner_status_idx on public.tasks(owner_agent_id, status);
create index tasks_project_idx on public.tasks(project_id);
create index tasks_created_by_idx on public.tasks(created_by) where created_by is not null;
create index work_logs_task_created_idx on public.work_logs(task_id, created_at desc);
create index work_logs_agent_created_idx on public.work_logs(agent_id, created_at desc);
create index work_logs_created_by_idx on public.work_logs(created_by) where created_by is not null;
create index daily_updates_date_idx on public.daily_updates(update_date desc);
create index daily_updates_created_by_idx on public.daily_updates(created_by) where created_by is not null;
create index approvals_status_due_idx on public.approvals(status, due_at);
create index approvals_task_idx on public.approvals(task_id) where task_id is not null;
create index approvals_project_idx on public.approvals(project_id) where project_id is not null;
create index approvals_requested_by_idx on public.approvals(requested_by_agent_id) where requested_by_agent_id is not null;
create index approvals_reviewer_idx on public.approvals(reviewer_agent_id) where reviewer_agent_id is not null;
create index approvals_decided_by_idx on public.approvals(decided_by) where decided_by is not null;
create index approvals_created_by_idx on public.approvals(created_by) where created_by is not null;
create index activity_log_created_idx on public.activity_log(created_at desc);
create index activity_log_entity_idx on public.activity_log(entity_type, entity_id);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function private.capture_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.activity_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data
  ) values (
    (select auth.uid()),
    lower(tg_op),
    tg_table_name,
    coalesce((case when tg_op = 'DELETE' then old.id else new.id end)::text, null),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function private.set_updated_at() from public;
revoke all on function private.capture_activity() from public;

create trigger operations_members_updated_at before update on public.operations_members
for each row execute function private.set_updated_at();
create trigger agents_updated_at before update on public.agents
for each row execute function private.set_updated_at();
create trigger projects_updated_at before update on public.projects
for each row execute function private.set_updated_at();
create trigger tasks_updated_at before update on public.tasks
for each row execute function private.set_updated_at();
create trigger work_logs_updated_at before update on public.work_logs
for each row execute function private.set_updated_at();
create trigger daily_updates_updated_at before update on public.daily_updates
for each row execute function private.set_updated_at();
create trigger approvals_updated_at before update on public.approvals
for each row execute function private.set_updated_at();

create trigger agents_activity after insert or update or delete on public.agents
for each row execute function private.capture_activity();
create trigger projects_activity after insert or update or delete on public.projects
for each row execute function private.capture_activity();
create trigger tasks_activity after insert or update or delete on public.tasks
for each row execute function private.capture_activity();
create trigger work_logs_activity after insert or update or delete on public.work_logs
for each row execute function private.capture_activity();
create trigger daily_updates_activity after insert or update or delete on public.daily_updates
for each row execute function private.capture_activity();
create trigger approvals_activity after insert or update or delete on public.approvals
for each row execute function private.capture_activity();

alter table public.operations_members enable row level security;
alter table public.agents enable row level security;
alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.work_logs enable row level security;
alter table public.daily_updates enable row level security;
alter table public.approvals enable row level security;
alter table public.activity_log enable row level security;

create policy "members read own membership" on public.operations_members
for select to authenticated
using ((select auth.uid()) = user_id and active);

create policy "active members read agents" on public.agents
for select to authenticated
using (exists (
  select 1 from public.operations_members m
  where m.user_id = (select auth.uid()) and m.active
));
create policy "operators create agents" on public.agents
for insert to authenticated
with check (exists (
  select 1 from public.operations_members m
  where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')
));
create policy "operators update agents" on public.agents
for update to authenticated
using (exists (
  select 1 from public.operations_members m
  where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')
))
with check (exists (
  select 1 from public.operations_members m
  where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')
));
create policy "operators delete agents" on public.agents
for delete to authenticated
using (exists (
  select 1 from public.operations_members m
  where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')
));

create policy "active members read projects" on public.projects for select to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active));
create policy "operators create projects" on public.projects for insert to authenticated
with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));
create policy "operators update projects" on public.projects for update to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')))
with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));
create policy "operators delete projects" on public.projects for delete to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));

create policy "active members read tasks" on public.tasks for select to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active));
create policy "operators create tasks" on public.tasks for insert to authenticated
with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));
create policy "operators update tasks" on public.tasks for update to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')))
with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));
create policy "operators delete tasks" on public.tasks for delete to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));

create policy "active members read work logs" on public.work_logs for select to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active));
create policy "operators create work logs" on public.work_logs for insert to authenticated
with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));
create policy "operators update work logs" on public.work_logs for update to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')))
with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));
create policy "operators delete work logs" on public.work_logs for delete to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));

create policy "active members read daily updates" on public.daily_updates for select to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active));
create policy "operators create daily updates" on public.daily_updates for insert to authenticated
with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));
create policy "operators update daily updates" on public.daily_updates for update to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')))
with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));
create policy "operators delete daily updates" on public.daily_updates for delete to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));

create policy "active members read approvals" on public.approvals for select to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active));
create policy "operators create approvals" on public.approvals for insert to authenticated
with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));
create policy "operators update approvals" on public.approvals for update to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')))
with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));
create policy "operators delete approvals" on public.approvals for delete to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));

create policy "active members read activity" on public.activity_log for select to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active));

revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select on public.operations_members, public.activity_log to authenticated;
grant select, insert, update, delete on public.agents, public.projects, public.tasks, public.work_logs, public.daily_updates, public.approvals to authenticated;
grant usage, select on sequence public.activity_log_id_seq to authenticated;

insert into public.operations_members (user_id, display_name, role, active, permissions)
values (
  'd550bf69-3af7-40da-a890-ff0138b17e62',
  'Tito',
  'owner',
  true,
  '{"all": true}'::jsonb
)
on conflict (user_id) do update set
  display_name = excluded.display_name,
  role = excluded.role,
  active = true,
  permissions = excluded.permissions;

insert into public.agents (code, name, role, lane, status, charter, capabilities, created_by)
values
  ('lupe', 'Lupe', 'Main operator', 'Operations', 'active', 'Turns Tito''s direction into instructions, watches every lane for drift, owns the daily brief, and operates the complete control center.', '["task_management","agent_management","projects","daily_updates","approvals","audit_visibility"]'::jsonb, 'd550bf69-3af7-40da-a890-ff0138b17e62'),
  ('d8-a', 'D8-A', 'Skydeo owner', 'Product + technical ops', 'active', 'Owns Skydeo execution, release readiness, onboarding, technical operations, and documentation.', '["product_ops","technical_ops","documentation","release_management"]'::jsonb, 'd550bf69-3af7-40da-a890-ff0138b17e62'),
  ('c-3po', 'C-3PO', 'Social media manager', 'Content + social', 'active', 'Runs publishing, the content calendar, platform coordination, campaign sequencing, and production status.', '["content_calendar","social_media","publishing","production"]'::jsonb, 'd550bf69-3af7-40da-a890-ff0138b17e62'),
  ('k2', 'K2', 'Quality gate', 'Research + optimization', 'active', 'Researches, optimizes, and signs off before applicable approval packages reach Tito.', '["research","optimization","quality_review","signoff"]'::jsonb, 'd550bf69-3af7-40da-a890-ff0138b17e62'),
  ('rex', 'Rex', 'Paid media specialist', 'Paid media', 'active', 'Owns paid acquisition, campaign structure, creative tests, pacing, and optimization.', '["paid_media","campaigns","creative_testing","budget_pacing"]'::jsonb, 'd550bf69-3af7-40da-a890-ff0138b17e62')
on conflict (code) do nothing;

insert into public.projects (name, slug, description, status, owner_agent_id, created_by)
select 'Herzen Co.', 'herzen-co', 'Company-wide operating roadmap and cross-lane execution.', 'active', a.id, 'd550bf69-3af7-40da-a890-ff0138b17e62'
from public.agents a where a.code = 'lupe'
on conflict (slug) do nothing;
insert into public.projects (name, slug, description, status, owner_agent_id, created_by)
select 'Skydeo', 'skydeo', 'Skydeo product, technical operations, and release management.', 'active', a.id, 'd550bf69-3af7-40da-a890-ff0138b17e62'
from public.agents a where a.code = 'd8-a'
on conflict (slug) do nothing;
insert into public.projects (name, slug, description, status, owner_agent_id, created_by)
select 'Content', 'content', 'Herzen Co. content production and publishing calendar.', 'active', a.id, 'd550bf69-3af7-40da-a890-ff0138b17e62'
from public.agents a where a.code = 'c-3po'
on conflict (slug) do nothing;
insert into public.projects (name, slug, description, status, owner_agent_id, created_by)
select 'Growth', 'growth', 'Organic research, optimization, and growth evidence.', 'active', a.id, 'd550bf69-3af7-40da-a890-ff0138b17e62'
from public.agents a where a.code = 'k2'
on conflict (slug) do nothing;
insert into public.projects (name, slug, description, status, owner_agent_id, created_by)
select 'Paid media', 'paid-media', 'Paid acquisition and campaign experimentation.', 'active', a.id, 'd550bf69-3af7-40da-a890-ff0138b17e62'
from public.agents a where a.code = 'rex'
on conflict (slug) do nothing;
