import type { DeliveryItem } from "./types";
import { disabledAutomationResult } from "./retirement";

export function titlesAndLinksOnly(items: DeliveryItem[]) {
  return { items: items.map(({ title, review_url }) => ({ title, review_url })) };
}

export async function sendLupeDelivery(
  type: "weekly_review_pack" | "publish_day_notice" | "lupe_check_in",
  _items: DeliveryItem[],
  _mode?: "final_checkpoint" | "heads_up",
  _testLabel?: "OCC TEST — DO NOT POST",
): Promise<{ queued: false; payload: ReturnType<typeof titlesAndLinksOnly>; provider: Record<string, unknown> }> {
  void _items;
  void _mode;
  void _testLabel;
  throw new Error(disabledAutomationResult("whatsapp_delivery", type).message);
}
