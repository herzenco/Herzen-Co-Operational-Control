import { isApiError, requireMember } from "../../../../utils/api/auth";
import { fail, ok, preflight, readJson } from "../../../../utils/api/responses";
import { validateCreative } from "../../../../utils/paid-media";

const FIELDS = ["campaign_id","work_item_id","request_id","ad_group_name","asset_type","format_ratio","destination_url","utm_source","utm_medium","utm_campaign","primary_text","cta","sitelink_text","sitelink_description_1","sitelink_description_2","callout_text","snippet_header","notes","supersedes_id"];

export async function GET(request: Request) {
  const context = await requireMember(request);
  if (isApiError(context)) return context;
  const url = new URL(request.url);
  let query = context.supabase.from("paid_media_creatives").select("*, campaign:paid_media_campaigns(*)").order("updated_at", { ascending: false }).limit(500);
  for (const key of ["campaign_id","work_item_id","ad_group_name","asset_type","workflow_state"] as const) {
    const value = url.searchParams.get(key); if (value) query = query.eq(key, value);
  }
  const { data, error } = await query;
  if (error) return fail(500, "database_error", error.message);
  const ids = (data || []).map((row) => row.id);
  const [{ data: variants }, { data: files }] = ids.length ? await Promise.all([
    context.supabase.from("paid_media_creative_variants").select("*").in("creative_id", ids).order("position"),
    context.supabase.from("paid_media_creative_files").select("*").in("creative_id", ids).order("uploaded_at"),
  ]) : [{ data: [] }, { data: [] }];
  return ok({ items: (data || []).map((row) => ({ ...row, variants: (variants || []).filter((v) => v.creative_id === row.id && v.creative_version === row.version), files: (files || []).filter((f) => f.creative_id === row.id) })) });
}

export async function POST(request: Request) {
  const context = await requireMember(request, { write: true, allowAgentWrite: true });
  if (isApiError(context)) return context;
  const body = await readJson(request); if (!body) return fail(400, "invalid_json", "Send a JSON request body.");
  const errors = validateCreative(body); if (errors.length) return fail(422, "validation_failed", errors.join(" "), { errors });
  const payload = Object.fromEntries(FIELDS.filter((key) => body[key] !== undefined).map((key) => [key, body[key]]));
  Object.assign(payload, context.user ? { uploaded_by: context.user.id, last_changed_by: context.user.id } : { uploaded_by_agent_id: context.agentId, last_changed_by_agent_id: context.agentId });
  const { data, error } = await context.supabase.from("paid_media_creatives").insert(payload).select().single();
  if (error || !data) return fail(400, "write_failed", error?.message || "Creative could not be created.");
  const variants = (Array.isArray(body.variants) ? body.variants : []).map((item, index) => {
    const value = item as Record<string, unknown>;
    return { creative_id: data.id, creative_version: 1, variant_type: value.variant_type, position: Number(value.position || index + 1), value: value.value };
  });
  if (variants.length) {
    const { error: variantError } = await context.supabase.from("paid_media_creative_variants").insert(variants);
    if (variantError) return fail(409, "variant_write_failed", variantError.message, { creative_id: data.id });
  }
  return ok({ ...data, variants }, { status: 201 });
}

export const OPTIONS = preflight;
