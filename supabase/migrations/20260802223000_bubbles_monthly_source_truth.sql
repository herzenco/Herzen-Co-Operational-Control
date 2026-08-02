-- Bubbles n Salt monthly source-of-truth flow, K2 research contract, package
-- generation, morning approval packets, and seven-point readiness QA.

create table public.content_research_records (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null unique references public.content_items(id) on delete cascade,
  researcher_agent_id uuid not null references public.agents(id) on delete restrict,
  what_is_happening text not null,
  why_it_fits_account text not null,
  how_and_why_it_fits_feed text not null,
  current_trend_or_context text,
  caption_angle text not null,
  suggested_posting_time time not null,
  status text not null default 'draft' check (status in ('draft', 'final')),
  finalized_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'final' and finalized_at is not null) or status = 'draft')
);

create table public.monthly_content_folders (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.content_properties(id) on delete cascade,
  channel_id uuid not null references public.content_channels(id) on delete cascade,
  month_start date not null check (month_start = date_trunc('month', month_start)::date),
  storage_bucket text not null default 'content-creative-assets',
  storage_prefix text not null,
  created_by_agent_id uuid references public.agents(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (property_id, channel_id, month_start)
);

alter table public.content_assets
  add column monthly_folder_id uuid references public.monthly_content_folders(id) on delete restrict,
  add column assigned_publish_date date,
  add column removable_after_copy boolean not null default false;

alter table public.content_items
  add column research_record_id uuid references public.content_research_records(id) on delete restrict,
  add column qa_checklist jsonb not null default '{}'::jsonb,
  add column qa_passed_at timestamptz,
  add column approval_packet jsonb not null default '{}'::jsonb,
  add column approval_packet_state text not null default 'not_created' check (approval_packet_state in ('not_created', 'queued', 'sent', 'matched', 'failed')),
  add column approval_packet_sent_at timestamptz;

create table public.posting_instruction_templates (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.content_properties(id) on delete cascade,
  name text not null,
  platform text not null,
  instructions text not null,
  max_hashtags integer not null default 5 check (max_hashtags between 0 and 30),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, name)
);

create table public.asset_remap_audit (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  publish_date date not null,
  prior_source_asset_id uuid references public.content_assets(id) on delete set null,
  new_source_asset_id uuid not null references public.content_assets(id) on delete restrict,
  prior_creative_asset_path text,
  new_creative_asset_path text not null,
  reason text not null,
  remapped_by uuid references auth.users(id) on delete set null,
  remapped_at timestamptz not null default now()
);

create table public.approval_delivery_packets (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  approval_id uuid not null references public.approvals(id) on delete cascade,
  channel text not null default 'whatsapp' check (channel = 'whatsapp'),
  scheduled_for timestamptz not null,
  payload jsonb not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'cancelled')),
  sent_at timestamptz,
  provider_message_id text,
  failure_message text,
  created_at timestamptz not null default now(),
  unique (content_item_id, channel, scheduled_for)
);

create index content_assets_monthly_folder_idx on public.content_assets(monthly_folder_id, assigned_publish_date);
create index content_research_status_idx on public.content_research_records(status, content_item_id);
create index asset_remap_audit_item_idx on public.asset_remap_audit(content_item_id, remapped_at desc);
create index approval_delivery_packets_due_idx on public.approval_delivery_packets(status, scheduled_for);

create or replace function private.bubbles_qa_passes(checklist jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce((checklist ->> 'image_matches_assigned_day')::boolean, false)
    and coalesce((checklist ->> 'bordered_monthly_source_export')::boolean, false)
    and coalesce((checklist ->> 'caption_matches_image')::boolean, false)
    and coalesce((checklist ->> 'k2_feed_fit_note_present')::boolean, false)
    and coalesce((checklist ->> 'hashtags_within_limit')::boolean, false)
    and coalesce((checklist ->> 'suggested_posting_time_present')::boolean, false)
    and coalesce((checklist ->> 'whatsapp_packet_matches_occ')::boolean, false)
$$;

create or replace function private.validate_bubbles_operating_package()
returns trigger language plpgsql set search_path = '' as $$
declare
  is_bubbles_instagram boolean;
begin
  select exists (
    select 1 from public.content_properties property
    join public.content_channels channel on channel.property_id = property.id
    where property.id = new.property_id and channel.id = new.channel_id
      and property.slug = 'bubbles-n-salt' and lower(channel.platform) = 'instagram'
  ) into is_bubbles_instagram;
  if not is_bubbles_instagram then return new; end if;

  if cardinality(new.hashtags) > 5 then
    raise exception 'Bubbles n Salt Instagram packages may use at most 5 hashtags.';
  end if;
  if new.status in ('ready_for_lupe', 'awaiting_tito', 'approved', 'scheduled', 'publishing', 'published') then
    if new.research_record_id is null or not exists (
      select 1 from public.content_research_records research
      where research.id = new.research_record_id and research.content_item_id = new.id and research.status = 'final'
    ) then raise exception 'Final K2 research is required before Bubbles content can become ready.'; end if;
    if new.source_asset_id is null or not exists (
      select 1 from public.content_assets asset
      join public.monthly_content_folders folder on folder.id = asset.monthly_folder_id
      where asset.id = new.source_asset_id and asset.content_item_id = new.id
        and asset.asset_role = 'source' and asset.is_current
        and asset.assigned_publish_date = (new.publish_at at time zone 'America/New_York')::date
        and coalesce((asset.metadata ->> 'bordered_export')::boolean, false)
    ) then raise exception 'The bordered monthly source-of-truth asset assigned to this day is required.'; end if;
    if nullif(btrim(new.posting_instructions), '') is null then
      raise exception 'Standard Bubbles posting instructions are required.';
    end if;
    if new.approval_id is null or new.approval_state = 'not_requested' then
      raise exception 'An approval request is required.';
    end if;
    if not private.bubbles_qa_passes(new.qa_checklist) then
      raise exception 'All 7 Bubbles QA checks must pass before ready state.';
    end if;
    new.qa_passed_at = coalesce(new.qa_passed_at, now());
  end if;
  return new;
end;
$$;

create trigger content_items_bubbles_operating_validate
before insert or update on public.content_items for each row
execute function private.validate_bubbles_operating_package();

insert into public.posting_instruction_templates (property_id, name, platform, instructions, max_hashtags)
select id, 'Bubbles n Salt — Instagram standard', 'instagram',
  E'Instagram only.\nUse the approved bordered export.\nUse the approved caption.\nUse up to 5 hashtags.\nUse the suggested posting time unless overridden.\nAfter posting, record the link and screenshot back in OCC.\nActual posting is done by Herzen.', 5
from public.content_properties where slug = 'bubbles-n-salt'
on conflict (property_id, name) do update set instructions = excluded.instructions, max_hashtags = excluded.max_hashtags, active = true;

create or replace function public.c3po_build_bubbles_package(target_content_item_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  item public.content_items%rowtype;
  research public.content_research_records%rowtype;
  c3po_id uuid;
  new_approval_id uuid;
  standard_instructions text;
  packet jsonb;
begin
  select * into item from public.content_items where id = target_content_item_id;
  if not found then raise exception 'Content item not found.'; end if;
  select * into research from public.content_research_records where id = item.research_record_id and status = 'final';
  if not found then raise exception 'Final K2 research must be in place before C-3PO builds the package.'; end if;
  if item.source_asset_id is null then raise exception 'Bordered monthly source asset must be in place before C-3PO builds the package.'; end if;
  select id into c3po_id from public.agents where lower(code) = 'c-3po';
  select instructions into standard_instructions from public.posting_instruction_templates where property_id = item.property_id and platform = 'instagram' and active order by updated_at desc limit 1;
  insert into public.approvals (content_item_id, requested_by_agent_id, title, summary, evidence, recommendation, due_at)
  values (item.id, c3po_id, 'Approve Bubbles n Salt post — ' || item.title,
    coalesce(nullif(btrim(item.caption), ''), research.caption_angle),
    jsonb_build_array(jsonb_build_object('source_asset_id', item.source_asset_id, 'k2_research_record_id', research.id)),
    'Approve or reject the exact bordered image, caption, hashtags, and suggested posting time.', item.publish_at)
  returning id into new_approval_id;
  packet := jsonb_build_object(
    'final_bordered_image_asset_id', item.source_asset_id,
    'caption', coalesce(nullif(btrim(item.caption), ''), research.caption_angle),
    'hashtags', to_jsonb(item.hashtags[1:5]),
    'suggested_posting_time', research.suggested_posting_time,
    'k2_fit_note', research.how_and_why_it_fits_feed,
    'prompt', 'Approve or reject'
  );
  update public.content_items set
    caption = coalesce(nullif(btrim(caption), ''), research.caption_angle),
    hashtags = hashtags[1:5], posting_instructions = standard_instructions,
    approval_id = new_approval_id, approval_state = 'pending', approval_packet = packet,
    approval_packet_state = 'queued'
  where id = item.id;
  insert into public.approval_delivery_packets (content_item_id, approval_id, scheduled_for, payload)
  values (item.id, new_approval_id,
    ((item.publish_at at time zone 'America/New_York')::date + time '08:00') at time zone 'America/New_York', packet);
  return new_approval_id;
end;
$$;

revoke all on function public.c3po_build_bubbles_package(uuid) from public, anon;
grant execute on function public.c3po_build_bubbles_package(uuid) to authenticated;

alter table public.content_research_records enable row level security;
alter table public.monthly_content_folders enable row level security;
alter table public.posting_instruction_templates enable row level security;
alter table public.asset_remap_audit enable row level security;
alter table public.approval_delivery_packets enable row level security;

create policy "members read bubbles operations" on public.content_research_records for select to authenticated using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active));
create policy "operators manage bubbles research" on public.content_research_records for all to authenticated using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator'))) with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));
create policy "members read monthly folders" on public.monthly_content_folders for select to authenticated using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active));
create policy "operators manage monthly folders" on public.monthly_content_folders for all to authenticated using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator'))) with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));
create policy "members read posting templates" on public.posting_instruction_templates for select to authenticated using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active));
create policy "operators manage posting templates" on public.posting_instruction_templates for all to authenticated using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator'))) with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));
create policy "members read asset remap audit" on public.asset_remap_audit for select to authenticated using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active));
create policy "operators create asset remap audit" on public.asset_remap_audit for insert to authenticated with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));
create policy "members read approval delivery packets" on public.approval_delivery_packets for select to authenticated using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active));
create policy "operators manage approval delivery packets" on public.approval_delivery_packets for all to authenticated using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator'))) with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner', 'operator')));

grant select, insert, update, delete on public.content_research_records, public.monthly_content_folders, public.posting_instruction_templates to authenticated;
grant select, insert on public.asset_remap_audit to authenticated;
grant select, insert, update, delete on public.approval_delivery_packets to authenticated;

create or replace view public.bubbles_daily_operating_queue
with (security_invoker = true) as
select item.id, item.publish_at, item.status, item.approval_state, item.approval_packet_state,
  research.how_and_why_it_fits_feed as k2_fit_note,
  research.suggested_posting_time,
  item.caption, item.hashtags, item.posting_instructions, item.source_asset_id,
  private.bubbles_qa_passes(item.qa_checklist) as qa_passes,
  (research.status = 'final' and item.source_asset_id is not null
    and nullif(btrim(item.posting_instructions), '') is not null
    and item.approval_id is not null and private.bubbles_qa_passes(item.qa_checklist)) as ready
from public.content_items item
join public.content_properties property on property.id = item.property_id and property.slug = 'bubbles-n-salt'
join public.content_channels channel on channel.id = item.channel_id and lower(channel.platform) = 'instagram'
left join public.content_research_records research on research.id = item.research_record_id;

grant select on public.bubbles_daily_operating_queue to authenticated;
