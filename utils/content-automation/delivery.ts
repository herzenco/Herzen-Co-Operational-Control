import type { DeliveryItem } from "./types";

export function titlesAndLinksOnly(items: DeliveryItem[]) {
  return { items: items.map(({ title, review_url }) => ({ title, review_url })) };
}

export async function sendLupeDelivery(type: "weekly_review_pack" | "publish_day_notice" | "lupe_check_in", items: DeliveryItem[], mode?: "final_checkpoint" | "heads_up") {
  const endpoint = process.env.LUPE_DELIVERY_WEBHOOK_URL;
  const payload = { type, mode, ...titlesAndLinksOnly(items) };
  if (!endpoint) return { queued: true, payload };
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", ...(process.env.LUPE_DELIVERY_WEBHOOK_SECRET ? { Authorization: `Bearer ${process.env.LUPE_DELIVERY_WEBHOOK_SECRET}` } : {}) }, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error(`Lupe delivery failed (${response.status}).`);
  return { queued: false, payload, provider: await response.json().catch(() => ({})) };
}

