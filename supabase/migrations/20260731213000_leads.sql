create table public.leads (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.content_properties(id) on delete set null,
  assigned_agent_id uuid references public.agents(id) on delete set null,
  contact_name text not null,
  company text,
  email text,
  phone text,
  source text not null default 'website',
  subject text,
  inquiry text not null,
  status text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'proposal', 'won', 'lost', 'spam')),
  priority text not null default 'medium' check (priority in ('urgent', 'high', 'medium', 'low')),
  next_follow_up_at timestamptz,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email is not null or phone is not null)
);

create index leads_status_created_idx on public.leads(status, created_at desc);
create index leads_property_created_idx on public.leads(property_id, created_at desc);
create index leads_assigned_status_idx on public.leads(assigned_agent_id, status);
create index leads_follow_up_idx on public.leads(next_follow_up_at) where next_follow_up_at is not null;

create trigger leads_updated_at before update on public.leads
for each row execute function private.set_updated_at();
create trigger leads_activity after insert or update or delete on public.leads
for each row execute function private.capture_activity();

alter table public.leads enable row level security;
create policy "active members read leads" on public.leads for select to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active));
create policy "operators create leads" on public.leads for insert to authenticated
with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));
create policy "operators update leads" on public.leads for update to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')))
with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));
create policy "operators delete leads" on public.leads for delete to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));

revoke all on public.leads from anon;
grant select, insert, update, delete on public.leads to authenticated;
