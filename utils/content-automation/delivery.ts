import type { DeliveryItem } from "./types";

export function titlesAndLinksOnly(items: DeliveryItem[]) {
  return { items: items.map(({ title, review_url }) => ({ title, review_url })) };
}

export async function sendLupeDelivery(type: "weekly_review_pack" | "publish_day_notice" | "lupe_check_in", items: DeliveryItem[], mode?: "final_checkpoint" | "heads_up", testLabel?: "OCC TEST — DO NOT POST") {
  const endpoint = process.env.LUPE_DELIVERY_WEBHOOK_URL;
  const payload = { type, mode, ...(testLabel ? { test_label: testLabel } : {}), ...titlesAndLinksOnly(items) };
  if (!endpoint) throw new Error("Lupe delivery webhook is not configured.");
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", ...(process.env.LUPE_DELIVERY_WEBHOOK_SECRET ? { Authorization: `Bearer ${process.env.LUPE_DELIVERY_WEBHOOK_SECRET}` } : {}) }, body: JSON.stringify(payload) });
  const provider = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(`Lupe delivery failed (${response.status}).`);
  if (provider.delivered !== true || !String(provider.id || "").trim()) {
    throw new Error("Lupe delivery webhook did not confirm a provider message ID.");
  }
  return { queued: false, payload, provider };
}
