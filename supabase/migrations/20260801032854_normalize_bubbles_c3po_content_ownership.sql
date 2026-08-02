-- Canonicalize the 31 recreated Bubbles n Salt August creatives and prevent
-- local filesystem paths from satisfying the C-3PO publishing requirement.

create or replace function private.validate_bubbles_c3po_content()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  is_bubbles boolean;
  is_c3po boolean;
  effective_caption text;
  effective_image text;
  metadata_image text;
begin
  select exists (
    select 1 from public.content_properties property
    where property.id = new.property_id and property.slug = 'bubbles-n-salt'
  ) into is_bubbles;

  select exists (
    select 1 from public.agents agent
    where agent.id = new.owner_agent_id and lower(agent.code) = 'c-3po'
  ) into is_c3po;

  if is_bubbles and is_c3po then
    metadata_image := nullif(btrim(new.metadata ->> 'image_url'), '');
    effective_caption := coalesce(
      nullif(btrim(new.caption), ''),
      nullif(btrim(new.metadata ->> 'caption'), '')
    );
    effective_image := coalesce(
      nullif(btrim(new.creative_asset_path), ''),
      case when metadata_image ~* '^(https?://|storage://content-creative-assets/)' then metadata_image end
    );

    if effective_caption is null then
      raise exception 'Bubbles n Salt content owned by C-3PO requires a caption.';
    end if;
    if effective_image is null then
      raise exception 'Bubbles n Salt content owned by C-3PO requires a hosted post image; local Assets/... paths are not accepted.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.validate_bubbles_c3po_content() from public;

do $$
declare
  target_count integer;
  compliant_count integer;
  hosted_count integer;
  updated_count integer;
begin
  select count(*), count(*) filter (
    where status = 'ready_for_lupe'
      and nullif(btrim(metadata ->> 'caption'), '') is not null
      and nullif(btrim(metadata ->> 'image_url'), '') is not null
      and coalesce((metadata ->> 'k2_consulted')::boolean, false)
  )
  into target_count, compliant_count
  from public.content_items
  where property_id = '28c377e7-0f86-4b69-909f-5b0e1f467fc2'::uuid
    and channel_id = '5ec5b70d-1aa7-45f5-adde-1189c95d38ca'::uuid
    and publish_at >= '2026-08-01T00:00:00Z'::timestamptz
    and publish_at < '2026-09-01T00:00:00Z'::timestamptz;

  if target_count <> 31 then
    raise exception 'Expected 31 August Bubbles n Salt rows, found %.', target_count;
  end if;
  if compliant_count <> 31 then
    raise exception 'Creative repair stopped: only % of 31 rows are ready and carry complete metadata.', compliant_count;
  end if;

  select count(*) into hosted_count
  from public.content_items item
  where item.property_id = '28c377e7-0f86-4b69-909f-5b0e1f467fc2'::uuid
    and item.channel_id = '5ec5b70d-1aa7-45f5-adde-1189c95d38ca'::uuid
    and item.publish_at >= '2026-08-01T00:00:00Z'::timestamptz
    and item.publish_at < '2026-09-01T00:00:00Z'::timestamptz
    and exists (
      select 1 from storage.objects object
      where object.bucket_id = 'content-creative-assets'
        and object.name like '%/bubbles-n-salt/2026-08/day-'
          || to_char(item.publish_at at time zone 'America/New_York', 'DD') || '.%'
    );

  if hosted_count <> 31 then
    raise exception 'Creative repair stopped: only % of 31 hosted Storage objects were found.', hosted_count;
  end if;

  with hosted as (
    select item.id, object.name as object_path
    from public.content_items item
    join lateral (
      select candidate.name
      from storage.objects candidate
      where candidate.bucket_id = 'content-creative-assets'
        and candidate.name like '%/bubbles-n-salt/2026-08/day-'
          || to_char(item.publish_at at time zone 'America/New_York', 'DD') || '.%'
      order by candidate.updated_at desc nulls last, candidate.name
      limit 1
    ) object on true
    where item.property_id = '28c377e7-0f86-4b69-909f-5b0e1f467fc2'::uuid
      and item.channel_id = '5ec5b70d-1aa7-45f5-adde-1189c95d38ca'::uuid
      and item.publish_at >= '2026-08-01T00:00:00Z'::timestamptz
      and item.publish_at < '2026-09-01T00:00:00Z'::timestamptz
  )
  update public.content_items item
  set caption = coalesce(nullif(btrim(item.caption), ''), nullif(btrim(item.metadata ->> 'caption'), '')),
      creative_asset_path = hosted.object_path,
      owner_agent_id = '59dabf9a-4e4a-497f-9561-7ebb0663c147'::uuid,
      research_owner_agent_id = 'bbb00b09-0e7e-4981-8155-ea4f39d4fa2c'::uuid,
      metadata = jsonb_set(
        case
          when item.metadata ->> 'image_url' ~* '^(?:\.\.?/|/)?Assets/'
          then jsonb_set(item.metadata, '{source_image_path}', item.metadata -> 'image_url', true)
          else item.metadata
        end,
        '{image_url}',
        to_jsonb('storage://content-creative-assets/' || hosted.object_path),
        true
      )
  from hosted
  where item.id = hosted.id;

  get diagnostics updated_count = row_count;
  raise notice 'Canonicalized % August Bubbles n Salt creatives.', updated_count;

  if (
    select count(*) from public.content_items item
    where item.property_id = '28c377e7-0f86-4b69-909f-5b0e1f467fc2'::uuid
      and item.channel_id = '5ec5b70d-1aa7-45f5-adde-1189c95d38ca'::uuid
      and item.publish_at >= '2026-08-01T00:00:00Z'::timestamptz
      and item.publish_at < '2026-09-01T00:00:00Z'::timestamptz
      and item.status = 'ready_for_lupe'
      and item.owner_agent_id = '59dabf9a-4e4a-497f-9561-7ebb0663c147'::uuid
      and item.research_owner_agent_id = 'bbb00b09-0e7e-4981-8155-ea4f39d4fa2c'::uuid
      and nullif(btrim(item.caption), '') is not null
      and nullif(btrim(item.creative_asset_path), '') is not null
      and item.metadata ->> 'image_url' like 'storage://content-creative-assets/%'
  ) <> 31 then
    raise exception 'Post-repair verification failed for August Bubbles n Salt creatives.';
  end if;
end;
$$;
