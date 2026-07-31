import { readFile } from "node:fs/promises";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_STATE_PATH =
  "/Users/tito/.openclaw/workspace/memory/herzenco-content-automation-state.json";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function required(value, label) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${label}`);
  }
  return value;
}

function channelKeyForItem(item) {
  if (item.kind === "linkedin") return "herzen-co::linkedin";
  return "herzen-co::website";
}

function contentTypeKeyForItem(item) {
  if (item.kind === "linkedin") return "linkedin-post";
  return "website-article";
}

function occStatusForLegacyStatus(status) {
  if (status === "scheduled") return "scheduled";
  if (status === "approved") return "approved";
  if (status === "published") return "published";
  return "ready_for_lupe";
}

function publishAt(item) {
  if (item.publish_at) return item.publish_at;
  if (!item.date || !item.publish_time_et) return null;
  const [hour, minute] = item.publish_time_et.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

  // Convert ET wall time into UTC ISO with a simple explicit offset.
  const utcHour = hour + 4;
  const utcDate = new Date(`${item.date}T00:00:00.000Z`);
  utcDate.setUTCHours(utcHour, minute, 0, 0);
  return utcDate.toISOString();
}

async function loadLookup(supabase, table, columns = "id,name,slug,platform,account_name,code") {
  const { data, error } = await supabase.from(table).select(columns);
  if (error) throw error;
  return data || [];
}

async function main() {
  const statePath = process.argv[2] || DEFAULT_STATE_PATH;
  const supabase = createClient(
    required(SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL"),
    required(SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const raw = await readFile(statePath, "utf8");
  const state = JSON.parse(raw);
  const items = Array.isArray(state.planned_items) ? state.planned_items : [];

  const [properties, channels, contentTypes, agents] = await Promise.all([
    loadLookup(supabase, "content_properties", "id,name,slug"),
    loadLookup(supabase, "content_channels", "id,property_id,platform,account_name"),
    loadLookup(supabase, "content_types", "id,name,slug"),
    loadLookup(supabase, "agents", "id,code,name"),
  ]);

  const propertyId = properties.find((entry) => entry.slug === "herzen-co")?.id;
  const c3poId = agents.find((entry) => String(entry.code).toLowerCase() === "c-3po")?.id;
  const k2Id = agents.find((entry) => String(entry.code).toLowerCase() === "k2")?.id;

  if (!propertyId) {
    throw new Error("Could not find the Herzen Co. content property in OCC.");
  }

  const channelMap = new Map(
    channels
      .filter((entry) => entry.property_id === propertyId)
      .map((entry) => [`herzen-co::${entry.platform}`, entry.id]),
  );
  const typeMap = new Map(
    contentTypes.map((entry) => [entry.slug, entry.id]),
  );

  let created = 0;
  let updated = 0;

  for (const item of items) {
    const legacyContentItemId = item.content_id;
    if (!legacyContentItemId) continue;

    const channelId = channelMap.get(channelKeyForItem(item));
    if (!channelId) continue;

    const contentTypeId = typeMap.get(contentTypeKeyForItem(item)) || null;
    const payload = {
      title: item.title,
      brief: `Imported from legacy Herzen Content Engine review pack for ${item.date}.`,
      property_id: propertyId,
      channel_id: channelId,
      content_type_id: contentTypeId,
      owner_agent_id: c3poId || null,
      research_owner_agent_id: k2Id || null,
      distribution_mode: "organic",
      status: occStatusForLegacyStatus(item.status),
      publish_at: publishAt(item),
      legacy_content_item_id: legacyContentItemId,
      legacy_review_url: item.review_url || null,
      source_system: "legacy_content_engine",
      metadata: {
        legacy_kind: item.kind || null,
        legacy_date: item.date || null,
        legacy_status: item.status || null,
      },
    };

    const { data: existing, error: existingError } = await supabase
      .from("content_items")
      .select("id")
      .eq("legacy_content_item_id", legacyContentItemId)
      .maybeSingle();

    if (existingError) throw existingError;

    if (existing?.id) {
      const { error } = await supabase
        .from("content_items")
        .update(payload)
        .eq("id", existing.id);
      if (error) throw error;
      updated += 1;
      continue;
    }

    const { error } = await supabase.from("content_items").insert(payload);
    if (error) throw error;
    created += 1;
  }

  console.log(JSON.stringify({ created, updated, scanned: items.length }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
