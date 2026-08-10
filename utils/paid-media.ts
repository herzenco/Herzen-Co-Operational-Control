export const CREATIVE_STATES = ["draft", "ready_for_review", "approved", "rejected", "superseded"] as const;
export const CREATIVE_ASSET_TYPES = ["RSA", "sitelink", "callout", "structured_snippet", "logo", "image"] as const;

export type CreativeState = typeof CREATIVE_STATES[number];

const TRANSITIONS: Record<CreativeState, CreativeState[]> = {
  draft: ["ready_for_review", "superseded"],
  ready_for_review: ["draft", "approved", "rejected", "superseded"],
  approved: ["superseded"],
  rejected: ["draft", "superseded"],
  superseded: [],
};

export function canTransition(from: string, to: string) {
  return CREATIVE_STATES.includes(from as CreativeState) && TRANSITIONS[from as CreativeState].includes(to as CreativeState);
}

export function validateCreative(input: Record<string, unknown>) {
  const errors: string[] = [];
  const type = String(input.asset_type || "");
  if (!CREATIVE_ASSET_TYPES.includes(type as typeof CREATIVE_ASSET_TYPES[number])) errors.push("A supported asset type is required.");
  if (!input.campaign_id) errors.push("Campaign is required.");
  if (!input.work_item_id) errors.push("OCC work item is required.");
  if (["RSA", "sitelink"].includes(type) && !/^https?:\/\//.test(String(input.destination_url || ""))) errors.push("A valid destination URL is required for buildable ad assets.");
  if (type === "RSA" && !String(input.ad_group_name || "").trim()) errors.push("RSA assets require an ad group.");
  if (type === "sitelink" && !String(input.sitelink_text || "").trim()) errors.push("Sitelink text is required.");
  if (type === "callout" && !String(input.callout_text || "").trim()) errors.push("Callout text is required.");
  if (type === "structured_snippet" && !String(input.snippet_header || "").trim()) errors.push("A structured-snippet header is required.");
  if (input.cta && !["book a meeting", "book a call", "schedule a meeting"].includes(String(input.cta).trim().toLowerCase())) errors.push("CTA must align with the Calendly booking objective.");
  const variants = Array.isArray(input.variants) ? input.variants : [];
  if (type === "RSA" && !variants.some((v) => typeof v === "object" && v && (v as Record<string, unknown>).variant_type === "headline")) errors.push("RSA assets require at least one headline.");
  if (type === "structured_snippet" && !variants.some((v) => typeof v === "object" && v && (v as Record<string, unknown>).variant_type === "snippet_value")) errors.push("Structured snippets require at least one value.");
  return errors;
}
