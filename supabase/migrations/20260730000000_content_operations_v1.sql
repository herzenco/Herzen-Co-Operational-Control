create table public.content_properties (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.content_channels (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.content_properties(id) on delete cascade,
  platform text not null check (platform in ('instagram', 'linkedin', 'website')),
  account_name text not null,
  account_identifier text,
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  publishing_mode text not null check (publishing_mode in ('manual', 'lupe_automated', 'occ_automated')),
  configuration jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, platform, account_name)
);

create table public.content_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  description text,
  status text not null default 'proposed' check (status in ('proposed', 'active', 'paused', 'archived')),
  recommended_by_agent_id uuid references public.agents(id) on delete set null,
  properties jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  brief text,
  body text,
  property_id uuid not null references public.content_properties(id) on delete restrict,
  channel_id uuid not null references public.content_channels(id) on delete restrict,
  content_type_id uuid references public.content_types(id) on delete set null,
  owner_agent_id uuid references public.agents(id) on delete set null,
  research_owner_agent_id uuid references public.agents(id) on delete set null,
  task_id uuid references public.tasks(id) on delete set null,
  approval_id uuid references public.approvals(id) on delete set null,
  distribution_mode text not null default 'organic' check (distribution_mode in ('organic', 'paid')),
  status text not null default 'idea' check (status in (
    'idea',
    'research_ready',
    'drafting',
    'ready_for_lupe',
    'awaiting_tito',
    'revision_requested',
    'approved',
    'scheduled',
    'publishing',
    'published',
    'blocked',
    'failed',
    'cancelled'
  )),
  approval_required boolean not null default true,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  publish_at timestamptz,
  published_at timestamptz,
  final_url text,
  screenshot_path text,
  external_job_id text,
  external_status text,
  failure_message text,
  research_brief jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.content_status_history (
  id bigint generated always as identity primary key,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  from_status text,
  to_status text not null,
  note text,
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.approvals
  add column content_item_id uuid references public.content_items(id) on delete set null;

create index content_properties_status_idx on public.content_properties(status);
create index content_channels_property_platform_idx on public.content_channels(property_id, platform);
create index content_channels_status_idx on public.content_channels(status);
create index content_types_status_idx on public.content_types(status);
create index content_items_status_publish_idx on public.content_items(status, publish_at);
create index content_items_property_idx on public.content_items(property_id);
create index content_items_channel_idx on public.content_items(channel_id);
create index content_items_owner_idx on public.content_items(owner_agent_id) where owner_agent_id is not null;
create index content_items_approval_idx on public.content_items(approval_id) where approval_id is not null;
create index content_status_history_item_created_idx on public.content_status_history(content_item_id, created_at desc);
create index approvals_content_item_idx on public.approvals(content_item_id) where content_item_id is not null;

create or replace function private.validate_content_item()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  selected_platform text;
begin
  select platform into selected_platform
  from public.content_channels
  where id = new.channel_id and property_id = new.property_id;

  if selected_platform is null then
    raise exception 'The selected channel does not belong to this property.';
  end if;

  if new.status in ('approved', 'scheduled', 'publishing', 'published')
     and new.approval_required
     and (new.approved_by is null or new.approved_at is null) then
    raise exception 'Tito approval must be recorded before content can advance to %.', new.status;
  end if;

  if new.status = 'scheduled' and new.publish_at is null then
    raise exception 'Scheduled content requires a publish date.';
  end if;

  if new.status = 'published' then
    if new.final_url is null or btrim(new.final_url) = '' then
      raise exception 'Published content requires its final URL.';
    end if;
    if selected_platform = 'instagram'
       and (new.screenshot_path is null or btrim(new.screenshot_path) = '') then
      raise exception 'Published Instagram content requires screenshot evidence.';
    end if;
    new.published_at = coalesce(new.published_at, now());
  end if;

  if new.status = 'failed'
     and (new.failure_message is null or btrim(new.failure_message) = '') then
    raise exception 'Failed publishing requires a failure message.';
  end if;

  return new;
end;
$$;

create or replace function private.capture_content_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    insert into public.content_status_history (
      content_item_id,
      from_status,
      to_status,
      changed_by
    ) values (
      new.id,
      case when tg_op = 'UPDATE' then old.status else null end,
      new.status,
      (select auth.uid())
    );
  end if;
  return new;
end;
$$;

revoke all on function private.validate_content_item() from public;
revoke all on function private.capture_content_status() from public;

create trigger content_properties_updated_at before update on public.content_properties
for each row execute function private.set_updated_at();
create trigger content_channels_updated_at before update on public.content_channels
for each row execute function private.set_updated_at();
create trigger content_types_updated_at before update on public.content_types
for each row execute function private.set_updated_at();
create trigger content_items_updated_at before update on public.content_items
for each row execute function private.set_updated_at();
create trigger content_items_validate before insert or update on public.content_items
for each row execute function private.validate_content_item();
create trigger content_items_status_history after insert or update of status on public.content_items
for each row execute function private.capture_content_status();

create trigger content_properties_activity after insert or update or delete on public.content_properties
for each row execute function private.capture_activity();
create trigger content_channels_activity after insert or update or delete on public.content_channels
for each row execute function private.capture_activity();
create trigger content_types_activity after insert or update or delete on public.content_types
for each row execute function private.capture_activity();
create trigger content_items_activity after insert or update or delete on public.content_items
for each row execute function private.capture_activity();

alter table public.content_properties enable row level security;
alter table public.content_channels enable row level security;
alter table public.content_types enable row level security;
alter table public.content_items enable row level security;
alter table public.content_status_history enable row level security;

create policy "active members read content properties" on public.content_properties
for select to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active));
create policy "operators create content properties" on public.content_properties
for insert to authenticated
with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));
create policy "operators update content properties" on public.content_properties
for update to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')))
with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));
create policy "operators delete content properties" on public.content_properties
for delete to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));

create policy "active members read content channels" on public.content_channels
for select to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active));
create policy "operators create content channels" on public.content_channels
for insert to authenticated
with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));
create policy "operators update content channels" on public.content_channels
for update to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')))
with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));
create policy "operators delete content channels" on public.content_channels
for delete to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));

create policy "active members read content types" on public.content_types
for select to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active));
create policy "operators create content types" on public.content_types
for insert to authenticated
with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));
create policy "operators update content types" on public.content_types
for update to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')))
with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));
create policy "operators delete content types" on public.content_types
for delete to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));

create policy "active members read content items" on public.content_items
for select to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active));
create policy "operators create content items" on public.content_items
for insert to authenticated
with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));
create policy "operators update content items" on public.content_items
for update to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')))
with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));
create policy "operators delete content items" on public.content_items
for delete to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));

create policy "active members read content history" on public.content_status_history
for select to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active));

grant select, insert, update, delete on
  public.content_properties,
  public.content_channels,
  public.content_types,
  public.content_items
to authenticated;
grant select on public.content_status_history to authenticated;
grant usage, select on sequence public.content_status_history_id_seq to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'content-publication-evidence',
  'content-publication-evidence',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "members read publication evidence" on storage.objects
for select to authenticated
using (
  bucket_id = 'content-publication-evidence'
  and exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active)
);
create policy "operators upload publication evidence" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'content-publication-evidence'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator'))
);
create policy "operators update publication evidence" on storage.objects
for update to authenticated
using (
  bucket_id = 'content-publication-evidence'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator'))
)
with check (
  bucket_id = 'content-publication-evidence'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator'))
);

insert into public.content_properties (name, slug, status, notes, created_by)
values
  ('Herzen Co.', 'herzen-co', 'active', 'Primary Herzen Co. content property.', null),
  ('Humanismo Evolutivo', 'humanismo-evolutivo', 'paused', 'Website content is intentionally paused until Tito reactivates it.', null),
  ('Bubbles n Salt', 'bubbles-n-salt', 'active', 'Instagram content property.', null)
on conflict (slug) do update set
  name = excluded.name,
  status = excluded.status,
  notes = excluded.notes;

insert into public.content_channels (property_id, platform, account_name, status, publishing_mode, created_by)
select p.id, seed.platform, seed.account_name, seed.status, seed.publishing_mode, null
from public.content_properties p
join (values
  ('herzen-co', 'instagram', 'Herzen Co. Instagram', 'active', 'manual'),
  ('herzen-co', 'linkedin', 'Herzen Co. LinkedIn', 'active', 'lupe_automated'),
  ('herzen-co', 'website', 'Herzen Co. Website', 'active', 'occ_automated'),
  ('humanismo-evolutivo', 'website', 'Humanismo Evolutivo Website', 'paused', 'occ_automated'),
  ('bubbles-n-salt', 'instagram', 'Bubbles n Salt Instagram', 'active', 'manual')
) as seed(property_slug, platform, account_name, status, publishing_mode)
  on p.slug = seed.property_slug
on conflict (property_id, platform, account_name) do update set
  status = excluded.status,
  publishing_mode = excluded.publishing_mode;

update public.agents
set
  role = 'Research and content optimization',
  charter = 'Supplies research, evidence, audience insight, and format recommendations that C-3PO and Rex reference when creating content.',
  capabilities = '["research","audience_insight","content_optimization","format_recommendations"]'::jsonb
where code = 'k2';

update public.agents
set
  charter = 'Creates organic social and website content using K2 research, manages the content calendar, and documents publishing outcomes.',
  capabilities = '["content_calendar","organic_social","website_content","publishing_coordination"]'::jsonb
where code = 'c-3po';

update public.agents
set
  charter = 'Creates paid Instagram and LinkedIn content using K2 research, operates campaigns, and documents performance and publication outcomes.'
where code = 'rex';
