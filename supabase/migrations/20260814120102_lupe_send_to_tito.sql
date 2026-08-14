-- Atomic Lupe-to-Tito editorial handoff for Monthly Content Operations v2.
-- This requests human review; it does not make an approval decision or enqueue publication.

create or replace function public.send_monthly_content_to_tito(
  target_content_item_id uuid,
  requesting_agent_id uuid,
  request_key text
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  item public.content_items%rowtype;
  lupe public.agents%rowtype;
  owner public.agents%rowtype;
  revision public.monthly_content_revisions%rowtype;
  audit public.content_audits%rowtype;
  source_asset public.content_assets%rowtype;
  delivery_asset public.content_assets%rowtype;
  review_work public.agent_work_items%rowtype;
  existing_approval public.approvals%rowtype;
  created_approval public.approvals%rowtype;
  existing_provenance jsonb;
  provenance jsonb;
  transition_id bigint;
  now_at timestamptz := clock_timestamp();
begin
  if nullif(btrim(request_key), '') is null then
    raise exception 'idempotency_key_required';
  end if;

  select * into lupe from public.agents
  where id = requesting_agent_id and lower(code) = 'lupe' and status = 'active';
  if not found then raise exception 'lupe_machine_identity_required'; end if;

  -- Serialize the key globally so it cannot concurrently identify two handoffs.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(btrim(request_key), 0));

  select approval, evidence_item
  into existing_approval, existing_provenance
  from public.approvals approval
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(approval.evidence) = 'array' then approval.evidence else '[]'::jsonb end
  ) evidence_item
  where evidence_item ->> 'kind' = 'monthly_content_lupe_handoff'
    and evidence_item ->> 'idempotency_key' = btrim(request_key)
  order by approval.created_at
  limit 1;

  if found then
    select * into item from public.content_items
    where id = existing_approval.content_item_id for update;
    if existing_approval.content_item_id is distinct from target_content_item_id
       or existing_approval.requested_by_agent_id is distinct from requesting_agent_id
       or existing_approval.status <> 'pending'
       or item.id is null
       or item.status <> 'ready_for_tito'
       or item.approval_id is distinct from existing_approval.id
       or item.approval_state <> 'pending'
       or existing_provenance ->> 'content_item_id' is distinct from target_content_item_id::text
       or existing_provenance ->> 'requesting_agent_id' is distinct from requesting_agent_id::text
       or existing_provenance ->> 'revision_id' is distinct from item.package_manifest ->> 'revision_id'
       or existing_provenance ->> 'source_asset_id' is distinct from item.source_asset_id::text
       or existing_provenance ->> 'delivery_asset_id' is distinct from item.delivery_asset_id::text
       or existing_provenance -> 'review_package' is distinct from item.package_manifest
       or not exists (
         select 1 from public.monthly_content_transition_events transition
         where transition.id = (existing_provenance ->> 'transition_id')::bigint
           and transition.content_item_id = target_content_item_id
           and transition.from_status = 'ready_for_lupe'
           and transition.to_status = 'ready_for_tito'
       )
       or not exists (
         select 1 from public.agent_work_items work
         where work.id = (existing_provenance ->> 'origin_work_item_id')::uuid
           and work.content_item_id = target_content_item_id
           and work.agent_id = requesting_agent_id
           and work.lane = 'monthly_content_lupe'
           and work.status = 'final'
       ) then
      raise exception 'idempotency_key_conflict';
    end if;
    return jsonb_build_object(
      'content_item_id', target_content_item_id,
      'approval_id', existing_approval.id,
      'revision_id', existing_provenance ->> 'revision_id',
      'review_package', existing_provenance -> 'review_package',
      'work_item_id', existing_provenance ->> 'origin_work_item_id',
      'transition_id', (existing_provenance ->> 'transition_id')::bigint,
      'status', 'ready_for_tito',
      'duplicate', true
    );
  end if;

  select * into item from public.content_items
  where id = target_content_item_id for update;
  if not found then raise exception 'content_item_not_found'; end if;
  if item.monthly_ops_version <> 2 then raise exception 'monthly_content_v2_required'; end if;
  if item.status <> 'ready_for_lupe' then raise exception 'content_item_not_ready_for_lupe'; end if;
  if item.approval_id is not null or item.approval_state <> 'not_requested' then
    raise exception 'content_item_approval_state_inconsistent';
  end if;

  if item.owner_agent_id is null then raise exception 'monthly_content_owner_required'; end if;
  select * into owner from public.agents where id = item.owner_agent_id and status = 'active';
  if not found then raise exception 'monthly_content_owner_inactive'; end if;
  if item.publish_at is null or not pg_catalog.isfinite(item.publish_at) then
    raise exception 'monthly_content_publish_at_required';
  end if;

  select * into revision from public.monthly_content_revisions
  where content_item_id = target_content_item_id
  order by revision desc
  limit 1
  for update;
  if not found then raise exception 'current_durable_revision_required'; end if;
  if item.package_manifest ->> 'revision_id' is distinct from revision.id::text
     or item.package_manifest ->> 'revision' is distinct from revision.revision::text then
    raise exception 'review_package_revision_mismatch';
  end if;

  if coalesce(revision.revised_snapshot -> 'title', 'null'::jsonb) is distinct from coalesce(to_jsonb(item.title), 'null'::jsonb)
     or coalesce(revision.revised_snapshot -> 'body', 'null'::jsonb) is distinct from coalesce(to_jsonb(item.body), 'null'::jsonb)
     or coalesce(revision.revised_snapshot -> 'caption', 'null'::jsonb) is distinct from coalesce(to_jsonb(item.caption), 'null'::jsonb)
     or coalesce(revision.revised_snapshot -> 'slug', 'null'::jsonb) is distinct from coalesce(to_jsonb(item.slug), 'null'::jsonb)
     or coalesce(revision.revised_snapshot -> 'seo_title', 'null'::jsonb) is distinct from coalesce(to_jsonb(item.seo_title), 'null'::jsonb)
     or coalesce(revision.revised_snapshot -> 'meta_description', 'null'::jsonb) is distinct from coalesce(to_jsonb(item.meta_description), 'null'::jsonb)
     or coalesce(revision.revised_snapshot -> 'reasoning_summary', 'null'::jsonb) is distinct from coalesce(to_jsonb(item.reasoning_summary), 'null'::jsonb) then
    raise exception 'current_content_revision_mismatch';
  end if;

  select * into audit from public.content_audits
  where content_item_id = target_content_item_id
    and iteration = revision.revision
    and provider = 'anthropic'
  for update;
  if not found then raise exception 'current_anthropic_audit_required'; end if;
  if not audit.passed or item.audit_status <> 'passed'
     or item.audit_iteration_count <> revision.revision
     or item.seo_score is distinct from audit.seo_score
     or item.aeo_score is distinct from audit.aeo_score then
    raise exception 'current_anthropic_audit_not_passed';
  end if;

  if item.source_asset_id is null or item.delivery_asset_id is null
     or item.package_manifest ->> 'source_asset_id' is distinct from item.source_asset_id::text
     or item.package_manifest ->> 'delivery_asset_id' is distinct from item.delivery_asset_id::text then
    raise exception 'review_package_assets_required';
  end if;
  select * into source_asset from public.content_assets
  where id = item.source_asset_id and content_item_id = target_content_item_id
    and asset_role = 'source' and is_current for update;
  if not found then raise exception 'current_source_asset_required'; end if;
  select * into delivery_asset from public.content_assets
  where id = item.delivery_asset_id and content_item_id = target_content_item_id
    and asset_role = 'delivery' and is_current for update;
  if not found then raise exception 'current_delivery_asset_required'; end if;

  if not ((source_asset.metadata ->> 'monthly_content_revision_id' = revision.id::text)
          or (revision.revision = 1 and source_asset.metadata ->> 'monthly_content_revision_id' is null))
     or not ((source_asset.metadata ->> 'monthly_content_revision' = revision.revision::text)
          or (revision.revision = 1 and source_asset.metadata ->> 'monthly_content_revision' is null))
     or not ((delivery_asset.metadata ->> 'monthly_content_revision_id' = revision.id::text)
          or (revision.revision = 1 and delivery_asset.metadata ->> 'monthly_content_revision_id' is null))
     or not ((delivery_asset.metadata ->> 'monthly_content_revision' = revision.revision::text)
          or (revision.revision = 1 and delivery_asset.metadata ->> 'monthly_content_revision' is null))
     or source_asset.metadata -> 'canonical_snapshot' is distinct from revision.revised_snapshot
     or delivery_asset.metadata -> 'canonical_snapshot' is distinct from revision.revised_snapshot then
    raise exception 'review_package_asset_revision_mismatch';
  end if;

  select * into review_work from public.agent_work_items
  where content_item_id = target_content_item_id
    and lane = 'monthly_content_lupe'
    and agent_id = requesting_agent_id
    and status in ('draft', 'in_progress', 'blocked', 'ready')
  for update;
  if not found then raise exception 'active_lupe_review_work_item_required'; end if;
  if not exists (
    select 1 from jsonb_array_elements(
      case when jsonb_typeof(review_work.attachments) = 'array' then review_work.attachments else '[]'::jsonb end
    ) attachment
    where attachment ->> 'revision_id' = revision.id::text
      and attachment ->> 'source_asset_id' = source_asset.id::text
      and attachment ->> 'delivery_asset_id' = delivery_asset.id::text
  ) then raise exception 'lupe_work_item_package_mismatch'; end if;

  if exists (select 1 from public.approvals where content_item_id = target_content_item_id and status = 'pending') then
    raise exception 'pending_tito_approval_conflict';
  end if;

  provenance := jsonb_build_object(
    'kind', 'monthly_content_lupe_handoff',
    'idempotency_key', btrim(request_key),
    'content_item_id', target_content_item_id,
    'requesting_agent_id', requesting_agent_id,
    'revision_id', revision.id,
    'revision', revision.revision,
    'source_asset_id', source_asset.id,
    'delivery_asset_id', delivery_asset.id,
    'review_package', item.package_manifest,
    'origin_work_item_id', review_work.id,
    'handed_off_at', now_at
  );

  insert into public.approvals (
    content_item_id, requested_by_agent_id, title, summary, evidence,
    recommendation, status, due_at
  ) values (
    target_content_item_id, requesting_agent_id,
    'Content approval: ' || item.title,
    coalesce(nullif(item.brief, ''), nullif(item.body, ''), 'Lupe submitted the current editorial revision for Tito review.'),
    jsonb_build_array(provenance),
    'Tito reviews the preserved current revision and either approves it or requests changes.',
    'pending', item.publish_at
  ) returning * into created_approval;

  update public.content_items set
    status = 'ready_for_tito',
    approval_id = created_approval.id,
    approval_state = 'pending',
    stage_owner_agent_id = null,
    next_action = 'Tito reviews the current editorial revision.',
    last_meaningful_activity_at = now_at,
    blocker = null,
    blocker_owner_agent_id = null
  where id = target_content_item_id and status = 'ready_for_lupe';
  if not found then raise exception 'content_item_transition_conflict'; end if;

  insert into public.monthly_content_transition_events (
    request_id, content_item_id, from_status, to_status, actor_type, actor_id,
    reason, evidence, retry_count, next_action
  ) values (
    coalesce(item.monthly_ops_request_id, 'REQ-20260810-122829-monthly-content-ops-root-repair'),
    target_content_item_id, 'ready_for_lupe', 'ready_for_tito', 'agent', requesting_agent_id::text,
    'Lupe sent the current editorial revision to Tito for human approval.',
    jsonb_build_array(provenance || jsonb_build_object('approval_id', created_approval.id)),
    item.audit_iteration_count,
    'Tito reviews the current editorial revision.'
  ) returning id into transition_id;

  update public.agent_work_items set
    status = 'final',
    notes = concat_ws(E'\n', nullif(notes, ''), 'Sent current editorial revision to Tito for human approval.')
  where id = review_work.id;

  update public.approvals set evidence = jsonb_build_array(
    provenance || jsonb_build_object('approval_id', created_approval.id, 'transition_id', transition_id)
  ) where id = created_approval.id returning * into created_approval;

  return jsonb_build_object(
    'content_item_id', target_content_item_id,
    'approval_id', created_approval.id,
    'revision_id', revision.id,
    'review_package', item.package_manifest,
    'work_item_id', review_work.id,
    'transition_id', transition_id,
    'status', 'ready_for_tito',
    'duplicate', false
  );
end;
$$;

revoke all on function public.send_monthly_content_to_tito(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.send_monthly_content_to_tito(uuid, uuid, text) to service_role;
