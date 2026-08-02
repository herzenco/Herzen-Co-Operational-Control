-- Agent-driven social operations: canonical artifacts, dependencies, feedback,
-- delivery assets, hard readiness gates, and a queryable operations view.

create table public.content_assets (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid references public.content_items(id) on delete cascade,
  asset_role text not null check (asset_role in ('source', 'delivery', 'reference', 'research')),
  storage_bucket text,
  storage_path text,
  external_url text,
  file_name text not null,
  mime_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  checksum_sha256 text,
  version integer not null default 1 check (version > 0),
  is_current boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  attached_by_agent_id uuid references public.agents(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (nullif(btrim(storage_path), '') is not null or nullif(btrim(external_url), '') is not null)
);

create table public.agent_work_items (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete restrict,
  work_item_type text not null check (work_item_type in ('research', 'optimization', 'organic_package', 'creative_proposal', 'paid_media_proposal', 'review', 'delivery', 'handoff', 'other')),
  title text not null,
  body text,
  summary text,
  attachments jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'in_progress', 'blocked', 'ready', 'final', 'delivered', 'cancelled')),
  content_item_id uuid references public.content_items(id) on delete cascade,
  campaign_id uuid references public.content_items(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  lane text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (content_item_id is not null or campaign_id is not null or project_id is not null or nullif(btrim(lane), '') is not null)
);

create table public.agent_work_dependencies (
  id uuid primary key default gen_random_uuid(),
  upstream_work_item_id uuid not null references public.agent_work_items(id) on delete cascade,
  downstream_work_item_id uuid not null references public.agent_work_items(id) on delete cascade,
  required boolean not null default true,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (upstream_work_item_id, downstream_work_item_id),
  check (upstream_work_item_id <> downstream_work_item_id)
);

alter table public.content_items
  add column hashtags text[] not null default '{}',
  add column posting_instructions text,
  add column tags text[] not null default '{}',
  add column cta text,
  add column approval_state text not null default 'not_requested' check (approval_state in ('not_requested', 'pending', 'changes_requested', 'approved', 'declined')),
  add column feedback_version integer not null default 0 check (feedback_version >= 0),
  add column package_manifest jsonb not null default '{}'::jsonb,
  add column publication_state text not null default 'unpublished' check (publication_state in ('unpublished', 'scheduled', 'publishing', 'published', 'failed')),
  add column source_asset_id uuid references public.content_assets(id) on delete restrict,
  add column delivery_asset_id uuid references public.content_assets(id) on delete restrict,
  add column linked_research_work_item_id uuid references public.agent_work_items(id) on delete restrict,
  add column linked_creative_work_item_id uuid references public.agent_work_items(id) on delete restrict,
  add column linked_paid_media_work_item_id uuid references public.agent_work_items(id) on delete restrict,
  add column delivered_at timestamptz,
  add column delivered_by_agent_id uuid references public.agents(id) on delete set null;

create table public.content_feedback (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid references public.content_items(id) on delete cascade,
  campaign_id uuid references public.content_items(id) on delete cascade,
  work_item_id uuid references public.agent_work_items(id) on delete cascade,
  body text not null,
  required boolean not null default true,
  status text not null default 'received' check (status in ('received', 'applied', 'blocked', 'superseded')),
  version integer not null default 1 check (version > 0),
  provided_by text not null default 'Herzen',
  applied_by_agent_id uuid references public.agents(id) on delete set null,
  applied_at timestamptz,
  resolution_note text,
  supersedes_feedback_id uuid references public.content_feedback(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(content_item_id, campaign_id, work_item_id) = 1),
  check ((status = 'applied' and applied_at is not null) or status <> 'applied')
);

create index content_assets_item_role_idx on public.content_assets(content_item_id, asset_role) where is_current;
create index agent_work_items_agent_status_idx on public.agent_work_items(agent_id, status);
create index agent_work_items_content_idx on public.agent_work_items(content_item_id) where content_item_id is not null;
create index agent_work_items_project_idx on public.agent_work_items(project_id) where project_id is not null;
create index agent_work_dependencies_downstream_idx on public.agent_work_dependencies(downstream_work_item_id) where required;
create index content_feedback_item_status_idx on public.content_feedback(content_item_id, status) where required;
create index content_feedback_work_status_idx on public.content_feedback(work_item_id, status) where required;
create index content_items_delivery_state_idx on public.content_items(publication_state, publish_at);

create or replace function private.validate_agent_work_advancement()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('ready', 'final', 'delivered') then
    if exists (
      select 1 from public.agent_work_dependencies dependency
      join public.agent_work_items upstream on upstream.id = dependency.upstream_work_item_id
      where dependency.downstream_work_item_id = new.id
        and dependency.required
        and upstream.status not in ('final', 'delivered')
    ) then
      raise exception 'Required upstream agent work must be final before this work item can advance.';
    end if;
    if new.status in ('final', 'delivered') and new.work_item_type = 'organic_package' and not exists (
      select 1 from public.agent_work_dependencies dependency
      join public.agent_work_items upstream on upstream.id = dependency.upstream_work_item_id
      where dependency.downstream_work_item_id = new.id and dependency.required
        and upstream.work_item_type in ('research', 'optimization') and upstream.status in ('final', 'delivered')
    ) then
      raise exception 'An organic package requires final K2 research or optimization work.';
    end if;
    if new.status in ('final', 'delivered') and new.work_item_type = 'paid_media_proposal' and (
      not exists (
        select 1 from public.agent_work_dependencies dependency join public.agent_work_items upstream on upstream.id = dependency.upstream_work_item_id
        where dependency.downstream_work_item_id = new.id and dependency.required and upstream.work_item_type in ('research', 'optimization') and upstream.status in ('final', 'delivered')
      ) or not exists (
        select 1 from public.agent_work_dependencies dependency join public.agent_work_items upstream on upstream.id = dependency.upstream_work_item_id
        where dependency.downstream_work_item_id = new.id and dependency.required and upstream.work_item_type in ('organic_package', 'creative_proposal') and upstream.status in ('final', 'delivered')
      )
    ) then
      raise exception 'A paid-media proposal requires final research and creative package dependencies.';
    end if;
    if exists (
      select 1 from public.content_feedback feedback
      where feedback.work_item_id = new.id and feedback.required
        and feedback.status in ('received', 'blocked')
    ) then
      raise exception 'Required feedback must be applied or superseded before this work item can advance.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.validate_social_content_package()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  delivery_asset public.content_assets%rowtype;
  source_asset public.content_assets%rowtype;
  is_c3po_package boolean;
begin
  if new.status in ('ready_for_lupe', 'awaiting_tito', 'approved', 'scheduled', 'publishing', 'published') then
    if nullif(btrim(coalesce(new.caption, new.body)), '') is null then
      raise exception 'A canonical caption is required before the package can advance.';
    end if;
    if new.source_asset_id is null or new.delivery_asset_id is null then
      raise exception 'Exact source and exported delivery assets are required before the package can advance.';
    end if;
    select * into source_asset from public.content_assets where id = new.source_asset_id;
    select * into delivery_asset from public.content_assets where id = new.delivery_asset_id;
    select exists (select 1 from public.agents agent where agent.id = new.owner_agent_id and lower(agent.code) = 'c-3po') into is_c3po_package;
    if source_asset.content_item_id is distinct from new.id or source_asset.asset_role <> 'source' or not source_asset.is_current then
      raise exception 'The selected source asset is not the current source asset for this OCC package.';
    end if;
    if delivery_asset.content_item_id is distinct from new.id or delivery_asset.asset_role <> 'delivery' or not delivery_asset.is_current then
      raise exception 'The selected delivery asset is not the current exported asset for this OCC package.';
    end if;
    if new.package_manifest <> '{}'::jsonb and (
      new.package_manifest ->> 'caption' is distinct from coalesce(new.caption, new.body)
      or new.package_manifest ->> 'source_asset_id' is distinct from new.source_asset_id::text
      or new.package_manifest ->> 'delivery_asset_id' is distinct from new.delivery_asset_id::text
    ) then
      raise exception 'The caption or assets disagree with the canonical OCC package manifest.';
    end if;
    if is_c3po_package and new.linked_research_work_item_id is null then
      raise exception 'C-3PO packages require linked final K2 research.';
    end if;
    if new.linked_research_work_item_id is not null and not exists (
      select 1 from public.agent_work_items work where work.id = new.linked_research_work_item_id
        and work.work_item_type in ('research', 'optimization') and work.status in ('final', 'delivered')
    ) then
      raise exception 'Linked research must be final before the content package can advance.';
    end if;
    if exists (
      select 1 from public.content_feedback feedback
      where feedback.content_item_id = new.id and feedback.required
        and feedback.status in ('received', 'blocked')
    ) then
      raise exception 'Required feedback must be applied or superseded before the content package can advance.';
    end if;
  end if;

  if new.status in ('approved', 'scheduled', 'publishing', 'published') and new.approval_state <> 'approved' then
    raise exception 'Structured approval must be approved before publication workflow can advance.';
  end if;
  if new.status in ('scheduled', 'publishing', 'published') and nullif(btrim(new.posting_instructions), '') is null then
    raise exception 'Posting instructions are required before scheduling or publishing.';
  end if;
  if new.delivered_at is not null and (new.delivery_asset_id is null or new.delivered_by_agent_id is null) then
    raise exception 'Delivery requires the exact OCC delivery asset and delivering agent.';
  end if;
  if new.status = 'published' then new.publication_state = 'published'; end if;
  if new.status = 'scheduled' then new.publication_state = 'scheduled'; end if;
  return new;
end;
$$;

revoke all on function private.validate_agent_work_advancement() from public;
revoke all on function private.validate_social_content_package() from public;

create trigger content_assets_updated_at before update on public.content_assets for each row execute function private.set_updated_at();
create trigger agent_work_items_updated_at before update on public.agent_work_items for each row execute function private.set_updated_at();
create trigger content_feedback_updated_at before update on public.content_feedback for each row execute function private.set_updated_at();
create trigger agent_work_items_validate before insert or update on public.agent_work_items for each row execute function private.validate_agent_work_advancement();
create trigger content_items_social_validate before insert or update on public.content_items for each row execute function private.validate_social_content_package();

create trigger content_assets_activity after insert or update or delete on public.content_assets for each row execute function private.capture_activity();
create trigger agent_work_items_activity after insert or update or delete on public.agent_work_items for each row execute function private.capture_activity();
create trigger agent_work_dependencies_activity after insert or update or delete on public.agent_work_dependencies for each row execute function private.capture_activity();
create trigger content_feedback_activity after insert or update or delete on public.content_feedback for each row execute function private.capture_activity();

alter table public.content_assets enable row level security;
alter table public.agent_work_items enable row level security;
alter table public.agent_work_dependencies enable row level security;
alter table public.content_feedback enable row level security;

create policy "members read social operations" on public.content_assets for select to authenticated using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active));
create policy "operators manage social assets" on public.content_assets for all to authenticated using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator'))) with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));
create policy "agents manage assigned social assets" on public.content_assets for all to authenticated
using (exists (select 1 from public.agents agent where agent.auth_user_id = (select auth.uid()) and (agent.id = content_assets.attached_by_agent_id or exists (select 1 from public.content_items item where item.id = content_assets.content_item_id and item.owner_agent_id = agent.id))))
with check (exists (select 1 from public.agents agent where agent.auth_user_id = (select auth.uid()) and (agent.id = content_assets.attached_by_agent_id or exists (select 1 from public.content_items item where item.id = content_assets.content_item_id and item.owner_agent_id = agent.id))));
create policy "members read agent work" on public.agent_work_items for select to authenticated using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active));
create policy "operators manage agent work" on public.agent_work_items for all to authenticated using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator'))) with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));
create policy "agents manage own work" on public.agent_work_items for all to authenticated
using (exists (select 1 from public.agents agent where agent.auth_user_id = (select auth.uid()) and agent.id = agent_work_items.agent_id))
with check (exists (select 1 from public.agents agent where agent.auth_user_id = (select auth.uid()) and agent.id = agent_work_items.agent_id));
create policy "members read work dependencies" on public.agent_work_dependencies for select to authenticated using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active));
create policy "operators manage work dependencies" on public.agent_work_dependencies for all to authenticated using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator'))) with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));
create policy "agents link own downstream dependencies" on public.agent_work_dependencies for all to authenticated
using (exists (select 1 from public.agent_work_items work join public.agents agent on agent.id = work.agent_id where work.id = agent_work_dependencies.downstream_work_item_id and agent.auth_user_id = (select auth.uid())))
with check (exists (select 1 from public.agent_work_items work join public.agents agent on agent.id = work.agent_id where work.id = agent_work_dependencies.downstream_work_item_id and agent.auth_user_id = (select auth.uid())));
create policy "members read content feedback" on public.content_feedback for select to authenticated using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active));
create policy "operators manage content feedback" on public.content_feedback for all to authenticated using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator'))) with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));
create policy "agents resolve assigned feedback" on public.content_feedback for update to authenticated
using (exists (select 1 from public.agents agent where agent.auth_user_id = (select auth.uid()) and (agent.id = content_feedback.applied_by_agent_id or exists (select 1 from public.agent_work_items work where work.id = content_feedback.work_item_id and work.agent_id = agent.id) or exists (select 1 from public.content_items item where item.id = content_feedback.content_item_id and item.owner_agent_id = agent.id))))
with check (exists (select 1 from public.agents agent where agent.auth_user_id = (select auth.uid()) and (agent.id = content_feedback.applied_by_agent_id or exists (select 1 from public.agent_work_items work where work.id = content_feedback.work_item_id and work.agent_id = agent.id) or exists (select 1 from public.content_items item where item.id = content_feedback.content_item_id and item.owner_agent_id = agent.id))));

create policy "agents update assigned content packages" on public.content_items for update to authenticated
using (exists (select 1 from public.agents agent where agent.auth_user_id = (select auth.uid()) and agent.id = content_items.owner_agent_id))
with check (exists (select 1 from public.agents agent where agent.auth_user_id = (select auth.uid()) and agent.id = content_items.owner_agent_id));
create policy "agents create assigned content packages" on public.content_items for insert to authenticated
with check (exists (select 1 from public.agents agent where agent.auth_user_id = (select auth.uid()) and agent.id = content_items.owner_agent_id));

grant select, insert, update, delete on public.content_assets, public.agent_work_items, public.agent_work_dependencies, public.content_feedback to authenticated;

create or replace view public.social_operations_queue
with (security_invoker = true)
as
select item.id, item.title, item.property_id, channel.platform, item.owner_agent_id,
  item.status, item.publish_at, item.approval_state, item.publication_state,
  exists (
    select 1 from public.content_feedback feedback where feedback.content_item_id = item.id
      and feedback.required and feedback.status in ('received', 'blocked')
  ) as has_unresolved_feedback,
  (item.delivery_asset_id is not null and item.source_asset_id is not null
    and nullif(btrim(coalesce(item.caption, item.body)), '') is not null
    and nullif(btrim(item.posting_instructions), '') is not null
    and item.approval_state = 'approved'
    and not exists (
      select 1 from public.content_feedback feedback where feedback.content_item_id = item.id
        and feedback.required and feedback.status in ('received', 'blocked')
    )) as ready_to_deliver
from public.content_items item
join public.content_channels channel on channel.id = item.channel_id;

grant select on public.social_operations_queue to authenticated;

-- Seed/update the four initial operating roles without assuming fixed UUIDs.
insert into public.agents (code, name, role, lane, charter, capabilities)
values
  ('K2', 'K2', 'Research and optimization', 'research', 'Produces canonical research and optimization artifacts for downstream agents.', '["research","optimization"]'::jsonb),
  ('C-3PO', 'C-3PO', 'Organic social planning and packaging', 'organic-social', 'Builds publish-ready organic packages from approved OCC inputs.', '["organic-social","content-packaging"]'::jsonb),
  ('Rex', 'Rex', 'Paid-media planning and proposals', 'paid-media', 'Builds paid-media proposals from canonical research and creative packages.', '["paid-media","proposal"]'::jsonb),
  ('Lupe', 'Lupe', 'Review and delivery', 'operations', 'Reviews and delivers only complete canonical OCC packages.', '["review","delivery"]'::jsonb)
on conflict (code) do update set role = excluded.role, lane = excluded.lane, charter = excluded.charter, capabilities = excluded.capabilities;
