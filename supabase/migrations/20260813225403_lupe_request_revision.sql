-- First-class Lupe editorial revision requests for Monthly Content Operations v2.
-- This action is intentionally separate from human approvals and publishing.

alter table public.content_feedback
  add column if not exists provided_by_agent_id uuid references public.agents(id) on delete set null,
  add column if not exists origin_work_item_id uuid references public.agent_work_items(id) on delete set null,
  add column if not exists request_revision_key text,
  add column if not exists application_evidence jsonb not null default '{}'::jsonb;

create unique index if not exists content_feedback_request_revision_key_uidx
  on public.content_feedback(content_item_id, request_revision_key)
  where request_revision_key is not null;

drop index if exists public.agent_work_items_monthly_lupe_uidx;
create unique index agent_work_items_monthly_lupe_active_uidx
  on public.agent_work_items(content_item_id, lane)
  where lane = 'monthly_content_lupe'
    and status in ('draft', 'in_progress', 'blocked', 'ready');

create or replace function public.request_monthly_content_revision(
  target_content_item_id uuid,
  requesting_agent_id uuid,
  review_feedback text,
  request_key text
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  item public.content_items%rowtype;
  lupe public.agents%rowtype;
  review_work public.agent_work_items%rowtype;
  existing_feedback public.content_feedback%rowtype;
  created_feedback public.content_feedback%rowtype;
  transition_id bigint;
  next_version integer;
  now_at timestamptz := clock_timestamp();
begin
  if nullif(btrim(review_feedback), '') is null then
    raise exception 'review_feedback_required';
  end if;
  if nullif(btrim(request_key), '') is null then
    raise exception 'idempotency_key_required';
  end if;

  select * into lupe from public.agents
  where id = requesting_agent_id and lower(code) = 'lupe' and status = 'active';
  if not found then raise exception 'lupe_machine_identity_required'; end if;

  select * into existing_feedback from public.content_feedback
  where content_item_id = target_content_item_id
    and request_revision_key = request_key;
  if found then
    if existing_feedback.provided_by_agent_id is distinct from requesting_agent_id
       or existing_feedback.body is distinct from btrim(review_feedback) then
      raise exception 'idempotency_key_conflict';
    end if;
    return jsonb_build_object(
      'content_item_id', target_content_item_id,
      'feedback_id', existing_feedback.id,
      'work_item_id', existing_feedback.origin_work_item_id,
      'status', 'revision_required',
      'duplicate', true
    );
  end if;

  select * into item from public.content_items
  where id = target_content_item_id for update;
  if not found then raise exception 'content_item_not_found'; end if;
  if item.status <> 'ready_for_lupe' then raise exception 'content_item_not_ready_for_lupe'; end if;

  select * into review_work from public.agent_work_items
  where content_item_id = target_content_item_id
    and lane = 'monthly_content_lupe'
    and agent_id = requesting_agent_id
    and status in ('draft', 'in_progress', 'blocked', 'ready')
  for update;
  if not found then raise exception 'active_lupe_review_work_item_required'; end if;

  next_version := item.feedback_version + 1;
  insert into public.content_feedback (
    content_item_id, body, required, status, version, provided_by,
    provided_by_agent_id, origin_work_item_id, request_revision_key
  ) values (
    target_content_item_id, btrim(review_feedback), true, 'received', next_version, 'Lupe',
    requesting_agent_id, review_work.id, request_key
  ) returning * into created_feedback;

  update public.content_items set
    status = 'revision_required',
    feedback_version = next_version,
    stage_owner_agent_id = null,
    next_action = 'OpenAI applies Lupe review feedback, then Anthropic re-audits the revision.',
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
    target_content_item_id, 'ready_for_lupe', 'revision_required', 'agent', requesting_agent_id::text,
    'Lupe requested editorial revision.',
    jsonb_build_array(jsonb_build_object('feedback_id', created_feedback.id, 'work_item_id', review_work.id)),
    item.audit_iteration_count,
    'OpenAI applies Lupe review feedback, then Anthropic re-audits the revision.'
  ) returning id into transition_id;

  update public.agent_work_items set
    status = 'final',
    notes = concat_ws(E'\n', nullif(notes, ''), 'Lupe requested revision: ' || btrim(review_feedback))
  where id = review_work.id;

  return jsonb_build_object(
    'content_item_id', target_content_item_id,
    'feedback_id', created_feedback.id,
    'work_item_id', review_work.id,
    'transition_id', transition_id,
    'status', 'revision_required',
    'duplicate', false
  );
end;
$$;

revoke all on function public.request_monthly_content_revision(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.request_monthly_content_revision(uuid, uuid, text, text) to service_role;
