-- OCC paid-media creative intake. This migration creates no ad-platform write capability.

create table public.paid_media_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  platform text not null,
  objective text not null,
  audience text not null,
  destination_url text not null check (destination_url ~ '^https?://'),
  utm_source text,
  utm_medium text,
  utm_campaign text,
  primary_conversion text,
  work_item_id uuid not null references public.agent_work_items(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_by_agent_id uuid references public.agents(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(created_by, created_by_agent_id) = 1)
);

create table public.paid_media_creatives (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.paid_media_campaigns(id) on delete restrict,
  work_item_id uuid not null references public.agent_work_items(id) on delete restrict,
  request_id text,
  ad_group_name text,
  asset_type text not null check (asset_type in ('RSA','sitelink','callout','structured_snippet','logo','image')),
  format_ratio text,
  destination_url text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  primary_text text,
  cta text,
  sitelink_text text,
  sitelink_description_1 text,
  sitelink_description_2 text,
  callout_text text,
  snippet_header text,
  notes text,
  workflow_state text not null default 'draft' check (workflow_state in ('draft','ready_for_review','approved','rejected','superseded')),
  version integer not null default 1 check (version > 0),
  supersedes_id uuid references public.paid_media_creatives(id) on delete restrict,
  uploaded_by uuid references auth.users(id) on delete restrict,
  uploaded_by_agent_id uuid references public.agents(id) on delete restrict,
  last_changed_by uuid references auth.users(id) on delete restrict,
  last_changed_by_agent_id uuid references public.agents(id) on delete restrict,
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(uploaded_by, uploaded_by_agent_id) = 1),
  check (num_nonnulls(last_changed_by, last_changed_by_agent_id) = 1),
  check ((workflow_state = 'approved' and approved_by is not null and approved_at is not null) or (workflow_state <> 'approved' and approved_by is null and approved_at is null)),
  check (asset_type not in ('RSA','sitelink') or destination_url ~ '^https?://'),
  check (asset_type <> 'RSA' or nullif(btrim(ad_group_name), '') is not null),
  check (asset_type <> 'sitelink' or nullif(btrim(sitelink_text), '') is not null),
  check (asset_type <> 'callout' or nullif(btrim(callout_text), '') is not null),
  check (asset_type <> 'structured_snippet' or nullif(btrim(snippet_header), '') is not null),
  check (lower(coalesce(cta, 'book a meeting')) in ('book a meeting','book a call','schedule a meeting'))
);

create table public.paid_media_creative_variants (
  id uuid primary key default gen_random_uuid(),
  creative_id uuid not null references public.paid_media_creatives(id) on delete cascade,
  creative_version integer not null default 1 check (creative_version > 0),
  variant_type text not null check (variant_type in ('headline','description','snippet_value')),
  position integer not null check (position > 0),
  value text not null check (nullif(btrim(value), '') is not null),
  created_at timestamptz not null default now(),
  unique (creative_id, creative_version, variant_type, position)
);

create table public.paid_media_creative_files (
  id uuid primary key default gen_random_uuid(),
  creative_id uuid not null references public.paid_media_creatives(id) on delete restrict,
  original_filename text not null,
  storage_bucket text not null default 'paid-media-creative-assets',
  storage_path text not null,
  mime_type text not null,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  uploaded_by uuid references auth.users(id) on delete restrict,
  uploaded_by_agent_id uuid references public.agents(id) on delete restrict,
  uploaded_at timestamptz not null default now(),
  check (num_nonnulls(uploaded_by, uploaded_by_agent_id) = 1),
  unique (storage_bucket, storage_path)
);

create table public.paid_media_creative_revisions (
  id bigint generated always as identity primary key,
  creative_id uuid not null references public.paid_media_creatives(id) on delete restrict,
  version integer not null,
  changed_by uuid references auth.users(id) on delete restrict,
  changed_by_agent_id uuid references public.agents(id) on delete restrict,
  changed_at timestamptz not null default now(),
  prior_state text,
  new_state text not null,
  before_data jsonb,
  after_data jsonb not null,
  check (num_nonnulls(changed_by, changed_by_agent_id) = 1),
  unique (creative_id, version)
);

create index paid_media_creatives_campaign_state_idx on public.paid_media_creatives(campaign_id, workflow_state, asset_type);
create index paid_media_creatives_work_item_idx on public.paid_media_creatives(work_item_id, workflow_state);
create index paid_media_creatives_review_idx on public.paid_media_creatives(updated_at desc) where workflow_state = 'ready_for_review';

create or replace function private.prepare_paid_media_creative_revision()
returns trigger language plpgsql set search_path = '' as $$
declare
  prior public.paid_media_creatives%rowtype;
begin
  if old.workflow_state = 'approved' and row(new.*) is distinct from row(old.*) and new.workflow_state = 'approved' then
    raise exception 'Approved creative is immutable; create a new draft revision and supersede the approved record.';
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  if new.workflow_state = 'approved' and new.supersedes_id is not null and old.workflow_state <> 'approved' then
    select * into prior from public.paid_media_creatives where id = new.supersedes_id for update;
    if prior.id is null or prior.workflow_state <> 'approved' or prior.campaign_id <> new.campaign_id or prior.work_item_id <> new.work_item_id then
      raise exception 'A replacement must supersede an approved creative in the same campaign and OCC work item.';
    end if;
    update public.paid_media_creatives set
      workflow_state = 'superseded', approved_by = null, approved_at = null,
      last_changed_by = new.last_changed_by, last_changed_by_agent_id = new.last_changed_by_agent_id
    where id = prior.id;
  end if;
  return new;
end;
$$;

create or replace function private.audit_paid_media_creative()
returns trigger language plpgsql set search_path = '' as $$
begin
  insert into public.paid_media_creative_revisions
    (creative_id, version, changed_by, changed_by_agent_id, prior_state, new_state, before_data, after_data)
  values
    (new.id, new.version, new.last_changed_by, new.last_changed_by_agent_id,
     case when tg_op = 'UPDATE' then old.workflow_state else null end, new.workflow_state,
     case when tg_op = 'UPDATE' then to_jsonb(old) else null end, to_jsonb(new));
  return new;
end;
$$;

create trigger paid_media_creatives_prepare before update on public.paid_media_creatives
for each row execute function private.prepare_paid_media_creative_revision();
create trigger paid_media_creatives_audit after insert or update on public.paid_media_creatives
for each row execute function private.audit_paid_media_creative();

create view public.approved_paid_media_asset_bundle with (security_invoker = true) as
select c.id as campaign_id, c.name as campaign_name, c.platform, c.objective, c.audience,
  c.primary_conversion, c.work_item_id, a.id as creative_id, a.request_id, a.ad_group_name,
  a.asset_type, a.destination_url, a.utm_source, a.utm_medium, a.utm_campaign, a.primary_text,
  a.cta, a.sitelink_text, a.sitelink_description_1, a.sitelink_description_2, a.callout_text,
  a.snippet_header, a.notes, a.version, a.approved_by, a.approved_at,
  coalesce((select jsonb_agg(jsonb_build_object('type', v.variant_type, 'position', v.position, 'value', v.value) order by v.variant_type, v.position) from public.paid_media_creative_variants v where v.creative_id = a.id and v.creative_version = a.version), '[]'::jsonb) as variants,
  coalesce((select jsonb_agg(jsonb_build_object('original_filename', f.original_filename, 'storage_bucket', f.storage_bucket, 'storage_path', f.storage_path, 'mime_type', f.mime_type, 'byte_size', f.byte_size, 'uploaded_at', f.uploaded_at) order by f.uploaded_at) from public.paid_media_creative_files f where f.creative_id = a.id), '[]'::jsonb) as files
from public.paid_media_campaigns c join public.paid_media_creatives a on a.campaign_id = c.id
where a.workflow_state = 'approved';

alter table public.paid_media_campaigns enable row level security;
alter table public.paid_media_creatives enable row level security;
alter table public.paid_media_creative_variants enable row level security;
alter table public.paid_media_creative_files enable row level security;
alter table public.paid_media_creative_revisions enable row level security;

create policy "members read paid media campaigns" on public.paid_media_campaigns for select to authenticated using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active));
create policy "operators manage paid media campaigns" on public.paid_media_campaigns for all to authenticated using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner','operator'))) with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner','operator')));
create policy "members read paid media creatives" on public.paid_media_creatives for select to authenticated using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active));
create policy "operators manage paid media creatives" on public.paid_media_creatives for all to authenticated using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner','operator'))) with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner','operator')));
create policy "members read paid media variants" on public.paid_media_creative_variants for select to authenticated using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active));
create policy "operators manage paid media variants" on public.paid_media_creative_variants for all to authenticated using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner','operator'))) with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner','operator')));
create policy "members read paid media files" on public.paid_media_creative_files for select to authenticated using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active));
create policy "operators manage paid media files" on public.paid_media_creative_files for all to authenticated using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner','operator'))) with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner','operator')));
create policy "members read paid media revisions" on public.paid_media_creative_revisions for select to authenticated using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active));

grant select, insert, update on public.paid_media_campaigns, public.paid_media_creatives, public.paid_media_creative_files to authenticated;
grant select, insert, update, delete on public.paid_media_creative_variants to authenticated;
grant select on public.paid_media_creative_revisions, public.approved_paid_media_asset_bundle to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('paid-media-creative-assets', 'paid-media-creative-assets', false, 10485760, array['image/png','image/jpeg','image/webp','image/svg+xml'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy "members read paid media files" on storage.objects for select to authenticated using (bucket_id = 'paid-media-creative-assets' and exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active));
create policy "operators upload paid media files" on storage.objects for insert to authenticated with check (bucket_id = 'paid-media-creative-assets' and exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner','operator')));

-- Month 1 canonical campaign and exact supplied RSA copy. No duplicate work item is created.
insert into public.paid_media_campaigns (name, platform, objective, audience, destination_url, utm_source, utm_medium, utm_campaign, primary_conversion, work_item_id, created_by_agent_id)
select 'HC | Search | Product Leadership | Broward + Palm Beach | Month 1', 'google_search', 'Booked Meeting - Calendly', 'Product leaders in Broward + Palm Beach',
  'https://www.herzenco.co/product-leadership/', 'google', 'cpc', 'hc_search_product_leadership_month_1', 'Booked Meeting - Calendly',
  w.id, w.agent_id from public.agent_work_items w where w.id = '46a40266-cd0d-48d5-a71a-41b63d88f43d'
on conflict (name) do nothing;

with campaign as (select * from public.paid_media_campaigns where name = 'HC | Search | Product Leadership | Broward + Palm Beach | Month 1'),
created as (
  insert into public.paid_media_creatives (campaign_id, work_item_id, ad_group_name, asset_type, destination_url, utm_source, utm_medium, utm_campaign, cta, workflow_state, uploaded_by_agent_id, last_changed_by_agent_id)
  select id, work_item_id, x.ad_group, 'RSA', destination_url, utm_source, utm_medium, utm_campaign, 'Book a meeting', 'draft', created_by_agent_id, created_by_agent_id
  from campaign cross join (values ('Fractional Product Leadership'), ('Execution Recovery / Project Management')) x(ad_group)
  returning id, ad_group_name
)
insert into public.paid_media_creative_variants (creative_id, variant_type, position, value)
select c.id, v.kind, v.position, v.value from created c cross join lateral (
  select * from (values
    ('headline',1,case when c.ad_group_name='Fractional Product Leadership' then 'Fractional Product Leadership' else 'Fix Execution Chaos' end),
    ('headline',2,case when c.ad_group_name='Fractional Product Leadership' then 'Senior Product Help Without Full-Time Overhead' else 'Project Recovery For Stalled Teams' end),
    ('headline',3,case when c.ad_group_name='Fractional Product Leadership' then 'Turn Product Chaos Into Clear Execution' else 'Restore Delivery Accountability' end),
    ('headline',4,case when c.ad_group_name='Fractional Product Leadership' then 'Align Roadmap Team And Stakeholders' else 'Get Teams Shipping Again' end),
    ('headline',5,case when c.ad_group_name='Fractional Product Leadership' then 'Product Strategy That Ships' else 'Roadmap And Stakeholder Alignment' end),
    ('headline',6,case when c.ad_group_name='Fractional Product Leadership' then 'Roadmap Clarity For Growing Teams' else 'Senior Operator For Critical Initiatives' end),
    ('headline',7,case when c.ad_group_name='Fractional Product Leadership' then 'Delivery Accountability For Founders' else 'Recover Missed Timelines Fast' end),
    ('headline',8,case when c.ad_group_name='Fractional Product Leadership' then 'Product Leadership For Digital Teams' else 'Execution Support For Product Teams' end),
    ('headline',9,case when c.ad_group_name='Fractional Product Leadership' then 'Execution Support Between Chaos And A Full-Time Hire' else 'Bring Order To Cross-Functional Delivery' end),
    ('headline',10,case when c.ad_group_name='Fractional Product Leadership' then 'Get A Senior Product Owner In The Room' else 'Rescue A Stalled Digital Initiative' end),
    ('headline',11,case when c.ad_group_name='Fractional Product Leadership' then 'Bring Structure To Product Delivery' else 'Clear Ownership For Complex Work' end),
    ('headline',12,case when c.ad_group_name='Fractional Product Leadership' then 'Book A Product Leadership Call' else 'Book A Recovery Call' end),
    ('description',1,case when c.ad_group_name='Fractional Product Leadership' then 'Bring senior product leadership to a growing team without committing to a full-time hire.' else 'For teams with missed deadlines, unclear ownership, or delivery drift across product and execution.' end),
    ('description',2,case when c.ad_group_name='Fractional Product Leadership' then 'Get roadmap clarity, stakeholder alignment, and real delivery accountability.' else 'Bring in senior help to reset priorities, create accountability, and move key work forward.' end),
    ('description',3,case when c.ad_group_name='Fractional Product Leadership' then 'Best for founders whose team is building but execution feels chaotic or slow.' else 'Ideal for digital-product teams that need structure and momentum, not more meetings.' end),
    ('description',4,case when c.ad_group_name='Fractional Product Leadership' then 'Create focus, ownership, and momentum across product decisions and delivery.' else 'Stabilize delivery, align stakeholders, and get critical initiatives moving again.' end)
  ) supplied(kind, position, value)
) v;
