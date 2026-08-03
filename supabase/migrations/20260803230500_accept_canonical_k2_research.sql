-- Allow the social package gate to recognize either the legacy work-item link
-- or the canonical final Phase 1 research record.

create or replace function private.validate_social_content_package()
returns trigger language plpgsql set search_path = '' as $$
declare
  delivery_asset public.content_assets%rowtype;
  source_asset public.content_assets%rowtype;
  is_c3po_package boolean;
  has_final_canonical_research boolean;
begin
  if new.status in ('ready_for_lupe', 'awaiting_tito', 'approved', 'scheduled', 'publishing', 'published') then
    if nullif(btrim(coalesce(new.caption, new.body)), '') is null then raise exception 'A canonical caption is required before the package can advance.'; end if;
    if new.source_asset_id is null or new.delivery_asset_id is null then raise exception 'Exact source and exported delivery assets are required before the package can advance.'; end if;
    select * into source_asset from public.content_assets where id = new.source_asset_id;
    select * into delivery_asset from public.content_assets where id = new.delivery_asset_id;
    select exists (select 1 from public.agents agent where agent.id = new.owner_agent_id and lower(agent.code) = 'c-3po') into is_c3po_package;
    select exists (
      select 1 from public.content_research_records research
      where research.id = new.research_record_id and research.content_item_id = new.id and research.status = 'final'
    ) into has_final_canonical_research;
    if source_asset.content_item_id is distinct from new.id or source_asset.asset_role <> 'source' or not source_asset.is_current then raise exception 'The selected source asset is not the current source asset for this OCC package.'; end if;
    if delivery_asset.content_item_id is distinct from new.id or delivery_asset.asset_role <> 'delivery' or not delivery_asset.is_current then raise exception 'The selected delivery asset is not the current exported asset for this OCC package.'; end if;
    if new.package_manifest <> '{}'::jsonb and (
      new.package_manifest ->> 'caption' is distinct from coalesce(new.caption, new.body)
      or new.package_manifest ->> 'source_asset_id' is distinct from new.source_asset_id::text
      or new.package_manifest ->> 'delivery_asset_id' is distinct from new.delivery_asset_id::text
    ) then raise exception 'The caption or assets disagree with the canonical OCC package manifest.'; end if;
    if is_c3po_package and new.linked_research_work_item_id is null and not has_final_canonical_research then raise exception 'C-3PO packages require linked final K2 research.'; end if;
    if new.linked_research_work_item_id is not null and not exists (
      select 1 from public.agent_work_items work where work.id = new.linked_research_work_item_id
        and work.work_item_type in ('research', 'optimization') and work.status in ('final', 'delivered')
    ) then raise exception 'Linked research must be final before the content package can advance.'; end if;
    if exists (select 1 from public.content_feedback feedback where feedback.content_item_id = new.id and feedback.required and feedback.status in ('received', 'blocked')) then raise exception 'Required feedback must be applied or superseded before the content package can advance.'; end if;
  end if;
  if new.status in ('approved', 'scheduled', 'publishing', 'published') and new.approval_state <> 'approved' then raise exception 'Structured approval must be approved before publication workflow can advance.'; end if;
  if new.status in ('scheduled', 'publishing', 'published') and nullif(btrim(new.posting_instructions), '') is null then raise exception 'Posting instructions are required before scheduling or publishing.'; end if;
  if new.delivered_at is not null and (new.delivery_asset_id is null or new.delivered_by_agent_id is null) then raise exception 'Delivery requires the exact OCC delivery asset and delivering agent.'; end if;
  if new.status = 'published' then new.publication_state = 'published'; end if;
  if new.status = 'scheduled' then new.publication_state = 'scheduled'; end if;
  return new;
end;
$$;

revoke all on function private.validate_social_content_package() from public;
