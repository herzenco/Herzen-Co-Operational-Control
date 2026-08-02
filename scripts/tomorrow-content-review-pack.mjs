import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function required(value, label) {
  if (!value) throw new Error(`Missing required environment variable: ${label}`);
  return value;
}

function tomorrowEtIsoDate() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const now = new Date();
  const parts = formatter.formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1, 12, 0, 0));
  return formatter.format(tomorrow);
}

function formatEt(dateString) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(dateString));
}

async function main() {
  const supabase = createClient(
    required(SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL"),
    required(SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const tomorrow = tomorrowEtIsoDate();
  const start = `${tomorrow}T00:00:00.000Z`;
  const end = `${tomorrow}T23:59:59.999Z`;

  const { data, error } = await supabase
    .from("content_items")
    .select(`
      id,
      title,
      status,
      publish_at,
      legacy_review_url,
      content_channels:channel_id (platform, account_name),
      content_properties:property_id (name)
    `)
    .gte("publish_at", start)
    .lte("publish_at", end)
    .order("publish_at", { ascending: true });

  if (error) throw error;

  if (!data?.length) {
    console.log(`Tomorrow has no OCC content scheduled for ${tomorrow}.`);
    return;
  }

  const lines = [`Tomorrow: ${tomorrow}`];
  for (const item of data) {
    const channel = Array.isArray(item.content_channels) ? item.content_channels[0] : item.content_channels;
    const property = Array.isArray(item.content_properties) ? item.content_properties[0] : item.content_properties;
    lines.push(
      [
        property?.name || "Unknown property",
        channel?.platform || "unknown-platform",
        formatEt(item.publish_at),
        item.status,
        item.title,
        item.legacy_review_url || "",
      ].join(" | "),
    );
  }
  lines.push("Reply with revisions, approval, or publishing instructions.");
  console.log(lines.join("\n"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
