-- Keep the Phase 1 gate invoker-safe by evaluating its private QA predicate
-- inside the trigger instead of requiring API roles to access private helpers.

create or replace function private.validate_herzen_phase1_package()
returns trigger language plpgsql set search_path = '' as $$
declare
  is_phase1 boolean;
  qa_passes boolean;
begin
  is_phase1 := coalesce((new.metadata ->> 'automation_phase')::integer, 0) = 1
    and exists (select 1 from public.content_properties p where p.id = new.property_id and p.slug = 'herzen-co');
  if not is_phase1 then return new; end if;

  if new.status in ('ready_for_lupe','awaiting_tito','approved','scheduled','publishing','published') then
    if new.paired_content_item_id is null or new.generation_run_id is null then
      raise exception 'Phase 1 content requires its generation run and paired asset.';
    end if;
    if new.research_record_id is null or not exists (
      select 1 from public.content_research_records r
      where r.id = new.research_record_id and r.content_item_id = new.id and r.status = 'final'
    ) then raise exception 'Final K2 research linkage is required.'; end if;
    if new.source_asset_id is null or not exists (
      select 1 from public.content_assets a where a.id = new.source_asset_id
        and a.content_item_id = new.id and a.asset_role = 'source' and a.is_current
    ) then raise exception 'Canonical source asset linkage is required.'; end if;
    if new.delivery_asset_id is null or not exists (
      select 1 from public.content_assets a where a.id = new.delivery_asset_id
        and a.content_item_id = new.id and a.asset_role = 'delivery' and a.is_current
    ) then raise exception 'Canonical delivery asset linkage is required.'; end if;
    if nullif(btrim(new.posting_instructions), '') is null then
      raise exception 'Platform posting instructions are required.';
    end if;
    if new.approval_id is null or new.approval_state = 'not_requested' or not exists (
      select 1 from public.approvals a where a.id = new.approval_id and a.content_item_id = new.id
    ) then raise exception 'A separate approval request is required for this asset.'; end if;
    if new.review_url is null or not exists (
      select 1 from public.content_review_links l where l.content_item_id = new.id and l.status = 'active'
    ) then raise exception 'An active OCC-native review link is required.'; end if;

    qa_passes := coalesce((new.qa_checklist ->> 'strategy_and_research_linked')::boolean, false)
      and coalesce((new.qa_checklist ->> 'source_asset_linked')::boolean, false)
      and coalesce((new.qa_checklist ->> 'delivery_asset_linked')::boolean, false)
      and coalesce((new.qa_checklist ->> 'platform_format_valid')::boolean, false)
      and coalesce((new.qa_checklist ->> 'seo_aeo_gate_passed')::boolean, false)
      and coalesce((new.qa_checklist ->> 'posting_instructions_present')::boolean, false)
      and coalesce((new.qa_checklist ->> 'independent_review_link_active')::boolean, false);
    if not qa_passes then raise exception 'All canonical Phase 1 QA checks must pass before review.'; end if;
    new.qa_passed_at = coalesce(new.qa_passed_at, now());
  end if;
  return new;
end;
$$;

revoke all on function private.validate_herzen_phase1_package() from public;
