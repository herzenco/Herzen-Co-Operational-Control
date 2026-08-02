-- Preserve the original, already-referenced lowercase roster identities and
-- consolidate case-only duplicates seeded by the social operations migration.

-- Point content packages at the work records owned by the original agents.
update public.content_items item
set linked_research_work_item_id = (
  select work.id
  from public.agent_work_items work
  join public.agents agent on agent.id = work.agent_id
  where work.content_item_id = item.id
    and work.work_item_type in ('research', 'optimization')
    and agent.code = 'k2'
  order by work.created_at, work.id
  limit 1
)
where item.linked_research_work_item_id is not null;

update public.content_items item
set linked_creative_work_item_id = (
  select work.id
  from public.agent_work_items work
  join public.agents agent on agent.id = work.agent_id
  where work.content_item_id = item.id
    and work.work_item_type = 'organic_package'
    and agent.code = 'c-3po'
  order by work.created_at, work.id
  limit 1
)
where item.linked_creative_work_item_id is not null;

-- Duplicate dependency pairs refer to duplicate work records. Rebuild the
-- canonical pairs after removing only work owned by the seeded duplicates.
delete from public.agent_work_dependencies dependency
using public.agent_work_items upstream, public.agent_work_items downstream,
  public.agents upstream_agent, public.agents downstream_agent
where upstream.id = dependency.upstream_work_item_id
  and downstream.id = dependency.downstream_work_item_id
  and upstream_agent.id = upstream.agent_id
  and downstream_agent.id = downstream.agent_id
  and (
    upstream_agent.code in ('K2', 'C-3PO', 'Rex', 'Lupe')
    or downstream_agent.code in ('K2', 'C-3PO', 'Rex', 'Lupe')
  );

delete from public.agent_work_items work
using public.agents agent
where agent.id = work.agent_id
  and agent.code in ('K2', 'C-3PO', 'Rex', 'Lupe');

insert into public.agent_work_dependencies (
  upstream_work_item_id, downstream_work_item_id, required, notes
)
select research.id, package.id, true,
  'K2 research must be canonical and final before the organic package advances.'
from public.agent_work_items research
join public.agents research_agent on research_agent.id = research.agent_id and research_agent.code = 'k2'
join public.agent_work_items package on package.content_item_id = research.content_item_id
join public.agents package_agent on package_agent.id = package.agent_id and package_agent.code = 'c-3po'
join public.content_items item on item.id = research.content_item_id
join public.content_properties property on property.id = item.property_id and property.slug = 'bubbles-n-salt'
where research.work_item_type in ('research', 'optimization')
  and package.work_item_type = 'organic_package'
on conflict (upstream_work_item_id, downstream_work_item_id) do nothing;

-- Nothing outside the duplicate backfill references the seeded case variants.
delete from public.agents
where code in ('K2', 'C-3PO', 'Rex', 'Lupe')
  and auth_user_id is null;

update public.agents set
  role = 'Research and optimization', lane = 'research',
  charter = 'Produces canonical research and optimization artifacts for downstream agents.',
  capabilities = '["research","optimization"]'::jsonb
where code = 'k2';
update public.agents set
  role = 'Organic social planning and packaging', lane = 'organic-social',
  charter = 'Builds publish-ready organic packages from approved OCC inputs.',
  capabilities = '["organic-social","content-packaging"]'::jsonb
where code = 'c-3po';
update public.agents set
  role = 'Paid-media planning and proposals', lane = 'paid-media',
  charter = 'Builds paid-media proposals from canonical research and creative packages.',
  capabilities = '["paid-media","proposal"]'::jsonb
where code = 'rex';
update public.agents set
  role = 'Review and delivery', lane = 'operations',
  charter = 'Reviews and delivers only complete canonical OCC packages.',
  capabilities = '["review","delivery"]'::jsonb
where code = 'lupe';

create unique index agents_code_case_insensitive_idx on public.agents (lower(code));
