-- Fix status-history writes without exposing direct INSERT access. The trigger
-- function is private, non-callable by API roles, and records auth.uid().
create or replace function private.capture_content_status()
returns trigger
language plpgsql
security definer
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

revoke all on function private.capture_content_status() from public;
revoke all on function private.capture_content_status() from anon, authenticated;

-- Preserve the existing hosted Bubbles exports as delivery assets. The legacy
-- rows do not contain original source files, so source_asset_id stays null.
insert into public.content_assets (
  content_item_id, asset_role, storage_bucket, storage_path, file_name,
  version, is_current, metadata, attached_by_agent_id
)
select item.id, 'delivery', 'content-creative-assets', item.creative_asset_path,
  regexp_replace(item.creative_asset_path, '^.*/', ''), 1, true,
  jsonb_build_object('provenance', 'legacy_creative_asset_path', 'backfilled_at', now()),
  item.owner_agent_id
from public.content_items item
join public.content_properties property on property.id = item.property_id
where property.slug = 'bubbles-n-salt'
  and nullif(btrim(item.creative_asset_path), '') is not null
  and not exists (
    select 1 from public.content_assets asset
    where asset.content_item_id = item.id and asset.asset_role = 'delivery' and asset.is_current
  );

-- Represent legacy K2 consultation honestly as draft research requiring full
-- canonical findings; do not promote the boolean flag into final research.
insert into public.agent_work_items (
  agent_id, work_item_type, title, summary, status, content_item_id, lane, notes
)
select k2.id, 'research', 'Canonicalize K2 research — ' || item.title,
  'Legacy metadata records K2 consultation, but no findings were stored. Add the actual research, sources, and recommendation before finalizing.',
  'draft', item.id, 'research', 'Backfilled from metadata.k2_consulted=true; no research content was invented.'
from public.content_items item
join public.content_properties property on property.id = item.property_id
join public.agents k2 on lower(k2.code) = 'k2'
where property.slug = 'bubbles-n-salt'
  and coalesce((item.metadata ->> 'k2_consulted')::boolean, false)
  and not exists (
    select 1 from public.agent_work_items work
    where work.content_item_id = item.id and work.agent_id = k2.id
      and work.work_item_type in ('research', 'optimization')
  );

insert into public.agent_work_items (
  agent_id, work_item_type, title, summary, attachments, status,
  content_item_id, lane, notes
)
select c3po.id, 'organic_package', 'Canonical organic package — ' || item.title,
  coalesce(item.caption, item.body, 'Caption missing'),
  jsonb_build_array('storage://content-creative-assets/' || item.creative_asset_path),
  'blocked', item.id, 'organic-social',
  'Legacy export preserved. Blocked until K2 findings, source asset, posting instructions, and approval are canonical in OCC.'
from public.content_items item
join public.content_properties property on property.id = item.property_id
join public.agents c3po on lower(c3po.code) = 'c-3po'
where property.slug = 'bubbles-n-salt'
  and not exists (
    select 1 from public.agent_work_items work
    where work.content_item_id = item.id and work.agent_id = c3po.id
      and work.work_item_type = 'organic_package'
  );

insert into public.agent_work_dependencies (
  upstream_work_item_id, downstream_work_item_id, required, notes
)
select research.id, package.id, true, 'K2 research must be canonical and final before the organic package advances.'
from public.agent_work_items research
join public.agent_work_items package on package.content_item_id = research.content_item_id
join public.content_items item on item.id = research.content_item_id
join public.content_properties property on property.id = item.property_id
where research.work_item_type in ('research', 'optimization')
  and package.work_item_type = 'organic_package'
  and property.slug = 'bubbles-n-salt'
  and not exists (
    select 1 from public.agent_work_dependencies dependency
    where dependency.upstream_work_item_id = research.id
      and dependency.downstream_work_item_id = package.id
  );

-- Remove the misleading ready state. Existing records remain blocked until the
-- absent facts are supplied and a real reviewer records approval.
update public.content_items item
set status = 'blocked',
    delivery_asset_id = delivery.id,
    linked_research_work_item_id = research.id,
    linked_creative_work_item_id = package.id,
    failure_message = null
from public.content_properties property,
  public.content_assets delivery,
  public.agent_work_items research,
  public.agent_work_items package
where property.id = item.property_id
  and property.slug = 'bubbles-n-salt'
  and item.status = 'ready_for_lupe'
  and delivery.content_item_id = item.id and delivery.asset_role = 'delivery' and delivery.is_current
  and research.content_item_id = item.id and research.work_item_type in ('research', 'optimization')
  and package.content_item_id = item.id and package.work_item_type = 'organic_package';
