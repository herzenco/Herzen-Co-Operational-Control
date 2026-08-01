#!/usr/bin/env node

import { readFile, access } from "node:fs/promises";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_MANIFEST = "/Users/tito/Library/Mobile Documents/com~apple~CloudDocs/Desktop/Lupe/Operating Agents/C-3PO/Bubbles n Salt/Instagram/2026-08 August/2026-08_posts.md";
const DEFAULT_AGENT_ROOT = "/Users/tito/Library/Mobile Documents/com~apple~CloudDocs/Desktop/Lupe/Operating Agents/C-3PO";

export function parsePostManifest(markdown) {
  const source = `${markdown.trimEnd()}\n## `;
  return [...source.matchAll(/^## (\d{4}-\d{2}-\d{2})\n([\s\S]*?)(?=^## )/gm)].map((match) => {
    const primary = match[2].match(/^- Primary asset: (.+)$/m)?.[1]?.trim() || "";
    return { date: match[1], primary };
  });
}

function contentType(extension) {
  const types = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
  return types[extension.toLowerCase()] || "application/octet-stream";
}

function easternDate(value) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/New_York",
  }).format(new Date(value));
}

async function main() {
  const apply = process.argv.includes("--apply");
  const quiet = process.argv.includes("--quiet");
  const manifestPath = process.env.BUBBLES_MANIFEST_PATH || DEFAULT_MANIFEST;
  const agentRoot = process.env.BUBBLES_AGENT_ROOT || DEFAULT_AGENT_ROOT;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const email = process.env.OCC_INTEGRATION_EMAIL || process.env.LUPE_API_EMAIL;
  const password = process.env.OCC_INTEGRATION_PASSWORD || process.env.LUPE_API_PASSWORD;
  if (!url || !key || !email || !password) throw new Error("Set Supabase URL/key and OCC_INTEGRATION_EMAIL/PASSWORD (LUPE_API_* is also supported).");

  const posts = parsePostManifest(await readFile(manifestPath, "utf8"));
  if (!posts.length) throw new Error(`No dated posts found in ${manifestPath}.`);
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await supabase.auth.signInWithPassword({ email, password });
  if (authError || !auth.user) throw authError || new Error("Could not authenticate.");

  const [{ data: property, error: propertyError }, { data: agent, error: agentError }] = await Promise.all([
    supabase.from("content_properties").select("id").eq("slug", "bubbles-n-salt").single(),
    supabase.from("agents").select("id").ilike("code", "c-3po").single(),
  ]);
  if (propertyError || !property) throw propertyError || new Error("Bubbles n Salt property not found.");
  if (agentError || !agent) throw agentError || new Error("C-3PO agent not found.");
  const { data: records, error: recordsError } = await supabase
    .from("content_items")
    .select("id,title,publish_at,caption,creative_asset_path,metadata,owner_agent_id")
    .eq("property_id", property.id)
    .eq("channel_id", "5ec5b70d-1aa7-45f5-adde-1189c95d38ca")
    .gte("publish_at", "2026-08-01T00:00:00-04:00")
    .lt("publish_at", "2026-09-01T00:00:00-04:00");
  if (recordsError) throw recordsError;

  const byDate = new Map((records || []).map((record) => [easternDate(record.publish_at), record]));
  const storageFolder = `${auth.user.id}/bubbles-n-salt/2026-08`;
  const { data: existingObjects, error: existingObjectsError } = await supabase.storage
    .from("content-creative-assets").list(storageFolder, { limit: 100 });
  if (existingObjectsError) throw new Error(`Could not inspect creative storage: ${existingObjectsError.message}`);
  const existingNames = new Set((existingObjects || []).map((object) => object.name));
  let changed = 0;
  let matched = 0;
  const written = [];
  for (const post of posts) {
    const record = byDate.get(post.date);
    if (!record) { console.warn(`SKIP ${post.date}: no OCC record`); continue; }
    matched += 1;
    const sourcePath = join(agentRoot, post.primary);
    await access(sourcePath);
    const extension = extname(sourcePath).toLowerCase();
    const day = post.date.slice(-2);
    const objectPath = `${auth.user.id}/bubbles-n-salt/2026-08/day-${day}${extension}`;
    if (!quiet) {
      console.log(`${apply ? "APPLY" : "PLAN "} ${post.date}: ${sourcePath} -> ${objectPath}`);
    }
    if (!apply) continue;
    const currentMetadata = record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata) ? record.metadata : {};
    const hostedImageReference = `storage://content-creative-assets/${objectPath}`;
    const metadata = {
      ...currentMetadata,
      ...(typeof currentMetadata.image_url === "string" && currentMetadata.image_url.startsWith("Assets/") ? { source_image_path: currentMetadata.image_url } : {}),
      image_url: hostedImageReference,
    };
    const caption = String(record.caption || currentMetadata.caption || "").trim();
    const needsUpdate = record.creative_asset_path !== objectPath
      || record.caption !== caption
      || currentMetadata.image_url !== hostedImageReference
      || record.owner_agent_id !== agent.id;
    if (needsUpdate) {
      if (!existingNames.has(objectPath.split("/").at(-1))) {
        const bytes = await readFile(sourcePath);
        const { error: uploadError } = await supabase.storage
          .from("content-creative-assets")
          .upload(objectPath, bytes, { contentType: contentType(extension), cacheControl: "31536000", upsert: false });
        if (uploadError) throw new Error(`${post.date} upload failed: ${uploadError.message}`);
        existingNames.add(objectPath.split("/").at(-1));
      }
      const { error: updateError } = await supabase
        .from("content_items")
        .update({
          caption,
          creative_asset_path: objectPath,
          metadata,
          owner_agent_id: agent.id,
          research_owner_agent_id: "bbb00b09-0e7e-4981-8155-ea4f39d4fa2c",
        })
        .eq("id", record.id);
      if (updateError) throw new Error(`${post.date} record update failed: ${updateError.message}`);
      changed += 1;
    }
    written.push({ id: record.id, date: post.date, path: objectPath });
  }
  if (apply) {
    const { data: storedObjects, error: listError } = await supabase.storage
      .from("content-creative-assets").list(`${auth.user.id}/bubbles-n-salt/2026-08`, { limit: 100 });
    if (listError) throw new Error(`Storage verification failed: ${listError.message}`);
    const storedNames = new Set((storedObjects || []).map((object) => object.name));
    for (const item of written) {
      if (!storedNames.has(item.path.split("/").at(-1))) throw new Error(`${item.date} Storage object verification failed.`);
      const { data: refreshed, error: refreshError } = await supabase
        .from("content_items").select("status,owner_agent_id,research_owner_agent_id,caption,creative_asset_path,metadata").eq("id", item.id).single();
      if (refreshError
        || refreshed?.status !== "ready_for_lupe"
        || refreshed?.owner_agent_id !== agent.id
        || refreshed?.research_owner_agent_id !== "bbb00b09-0e7e-4981-8155-ea4f39d4fa2c"
        || !String(refreshed?.caption || "").trim()
        || refreshed?.creative_asset_path !== item.path
        || refreshed?.metadata?.image_url !== `storage://content-creative-assets/${item.path}`) {
        throw new Error(`${item.date} content attachment verification failed.`);
      }
      const { data: signed, error: signedError } = await supabase.storage
        .from("content-creative-assets").createSignedUrl(item.path, 60);
      if (signedError || !signed?.signedUrl) throw new Error(`${item.date} signed preview verification failed.`);
    }
    console.log(`Verified ${written.length} Storage objects, persisted paths, and signed preview URLs.`);
  }
  console.log(`${apply ? "Updated" : "Planned"} ${apply ? changed : matched} Bubbles n Salt creative attachments${apply ? ` (${written.length} total verified)` : ""}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
