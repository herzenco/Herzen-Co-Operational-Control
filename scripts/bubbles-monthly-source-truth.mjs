#!/usr/bin/env node

import { access, copyFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_INSTAGRAM_ROOT = "/Users/tito/Library/Mobile Documents/com~apple~CloudDocs/Desktop/Lupe/Operating Agents/C-3PO/Bubbles n Salt/Instagram";
const STANDARD_INSTRUCTIONS = "Instagram only.\nUse the approved bordered export.\nUse the approved caption.\nUse up to 5 hashtags.\nUse the suggested posting time unless overridden.\nAfter posting, record the link and screenshot back in OCC.\nActual posting is done by Herzen.";

export function dateFromBorderedFile(name, month) {
  const match = name.match(/^(\d{4}-\d{2}-\d{2})_/);
  return match && match[1].startsWith(`${month}-`) ? match[1] : null;
}

export function validateMonthFiles(names, month, expectedDays) {
  const mapped = new Map();
  for (const name of names) {
    const date = dateFromBorderedFile(name, month);
    if (!date) continue;
    if (mapped.has(date)) throw new Error(`Duplicate bordered export for ${date}.`);
    mapped.set(date, name);
  }
  const missing = Array.from({ length: expectedDays }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`).filter((date) => !mapped.has(date));
  if (missing.length) throw new Error(`Missing bordered exports: ${missing.join(", ")}`);
  return mapped;
}

function easternDate(value) {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/New_York" }).format(new Date(value));
}

async function checksum(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function main() {
  const apply = process.argv.includes("--apply");
  const month = process.argv.find((arg) => /^\d{4}-\d{2}$/.test(arg)) || "2026-08";
  const instagramRoot = process.env.BUBBLES_INSTAGRAM_ROOT || DEFAULT_INSTAGRAM_ROOT;
  const borderedFolder = resolve(process.env.BUBBLES_BORDERED_FOLDER || join(instagramRoot, month === "2026-08" ? "august" : month));
  const sourceFolder = resolve(process.env.BUBBLES_SOURCE_TRUTH_FOLDER || join(instagramRoot, `${month} source-of-truth`));
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const files = validateMonthFiles(await readdir(borderedFolder), month, days);
  await Promise.all([...files.values()].map((name) => access(join(borderedFolder, name))));
  console.log(`${apply ? "APPLY" : "PLAN"}: ${files.size} date-matched bordered exports -> ${sourceFolder}`);
  if (!apply) return;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const email = process.env.OCC_INTEGRATION_EMAIL || process.env.LUPE_API_EMAIL;
  const password = process.env.OCC_INTEGRATION_PASSWORD || process.env.LUPE_API_PASSWORD;
  if (!url || !key || !email || !password) throw new Error("Set Supabase URL/key and OCC integration credentials.");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await supabase.auth.signInWithPassword({ email, password });
  if (authError || !auth.user) throw authError || new Error("Could not authenticate.");
  const [{ data: property, error: propertyError }, { data: channel, error: channelError }, { data: c3po, error: agentError }] = await Promise.all([
    supabase.from("content_properties").select("id").eq("slug", "bubbles-n-salt").single(),
    supabase.from("content_channels").select("id,property_id").ilike("platform", "instagram").eq("account_name", "Bubbles n Salt").single(),
    supabase.from("agents").select("id").ilike("code", "c-3po").single(),
  ]);
  if (propertyError || channelError || agentError || !property || !channel || !c3po) throw propertyError || channelError || agentError || new Error("Bubbles configuration missing.");
  const storagePrefix = `${auth.user.id}/bubbles-n-salt/${month}/source-of-truth`;
  const { data: folder, error: folderError } = await supabase.from("monthly_content_folders").upsert({ property_id: property.id, channel_id: channel.id, month_start: `${month}-01`, storage_bucket: "content-creative-assets", storage_prefix: storagePrefix, created_by_agent_id: c3po.id }, { onConflict: "property_id,channel_id,month_start" }).select("id").single();
  if (folderError || !folder) throw folderError || new Error("Could not register monthly folder.");
  const nextMonth = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 7);
  const { data: items, error: itemsError } = await supabase.from("content_items").select("id,publish_at,source_asset_id,creative_asset_path").eq("property_id", property.id).eq("channel_id", channel.id).gte("publish_at", `${month}-01T00:00:00-04:00`).lt("publish_at", `${nextMonth}-01T00:00:00-04:00`);
  if (itemsError) throw itemsError;
  const byDate = new Map((items || []).map((item) => [easternDate(item.publish_at), item]));
  if (byDate.size !== days) throw new Error(`Expected ${days} OCC items; found ${byDate.size}. No writes beyond the folder registration were made.`);

  await mkdir(sourceFolder, { recursive: true });
  for (const [date, name] of files) {
    const item = byDate.get(date);
    if (!item) throw new Error(`No OCC item assigned to ${date}.`);
    const input = join(borderedFolder, name);
    const output = join(sourceFolder, name);
    await copyFile(input, output);
    const objectPath = `${storagePrefix}/${name}`;
    const bytes = await readFile(output);
    const { error: uploadError } = await supabase.storage.from("content-creative-assets").upload(objectPath, bytes, { contentType: extname(name).toLowerCase() === ".png" ? "image/png" : "image/jpeg", upsert: false });
    if (uploadError && !/already exists|duplicate/i.test(uploadError.message)) throw uploadError;
    const digest = await checksum(output);
    const fileStat = await stat(output);
    const { data: asset, error: assetError } = await supabase.from("content_assets").insert({ content_item_id: item.id, asset_role: "source", storage_bucket: "content-creative-assets", storage_path: objectPath, file_name: basename(name), mime_type: extname(name).toLowerCase() === ".png" ? "image/png" : "image/jpeg", byte_size: fileStat.size, checksum_sha256: digest, is_current: true, monthly_folder_id: folder.id, assigned_publish_date: date, removable_after_copy: false, metadata: { bordered_export: true, source_of_truth: "monthly_folder", copied_from: input } }).select("id").single();
    if (assetError || !asset) throw assetError || new Error(`Could not register ${date} source asset.`);
    const { data: delivery, error: deliveryError } = await supabase.from("content_assets").insert({ content_item_id: item.id, asset_role: "delivery", storage_bucket: "content-creative-assets", storage_path: objectPath, file_name: basename(name), mime_type: extname(name).toLowerCase() === ".png" ? "image/png" : "image/jpeg", byte_size: fileStat.size, checksum_sha256: digest, is_current: true, monthly_folder_id: folder.id, assigned_publish_date: date, removable_after_copy: false, metadata: { bordered_export: true, source_of_truth: "monthly_folder", source_asset_id: asset.id } }).select("id").single();
    if (deliveryError || !delivery) throw deliveryError || new Error(`Could not register ${date} delivery asset.`);
    if (item.source_asset_id) await supabase.from("content_assets").update({ is_current: false, removable_after_copy: true }).eq("id", item.source_asset_id);
    const { error: updateError } = await supabase.from("content_items").update({ source_asset_id: asset.id, delivery_asset_id: delivery.id, creative_asset_path: objectPath, posting_instructions: STANDARD_INSTRUCTIONS, status: "blocked" }).eq("id", item.id);
    if (updateError) throw updateError;
    const { error: auditError } = await supabase.from("asset_remap_audit").insert({ content_item_id: item.id, publish_date: date, prior_source_asset_id: item.source_asset_id, new_source_asset_id: asset.id, prior_creative_asset_path: item.creative_asset_path, new_creative_asset_path: objectPath, reason: `${month} Bubbles remediation: remapped to date-matched bordered monthly export.` });
    if (auditError) throw auditError;
  }
  console.log(`Verified and remapped ${files.size}/${days} Bubbles items with an audit row per date. Prior source records are now marked removable_after_copy.`);
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
