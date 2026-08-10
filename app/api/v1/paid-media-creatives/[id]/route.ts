import { isApiError, requireMember } from "../../../../../utils/api/auth";
import { fail, ok, preflight, readJson } from "../../../../../utils/api/responses";
import { canTransition, validateCreative } from "../../../../../utils/paid-media";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const context = await requireMember(request, { write: true, allowAgentWrite: true });
  if (isApiError(context)) return context;
  const body = await readJson(request); if (!body) return fail(400, "invalid_json", "Send a JSON request body.");
  const { data: current, error: currentError } = await context.supabase.from("paid_media_creatives").select("*").eq("id", id).single();
  if (currentError || !current) return fail(404, "not_found", "Creative not found.");
  const nextState = String(body.workflow_state || current.workflow_state);
  if (nextState !== current.workflow_state && !canTransition(current.workflow_state, nextState)) return fail(409, "invalid_transition", `Cannot transition ${current.workflow_state} to ${nextState}.`);
  if (["approved", "rejected"].includes(nextState) && !context.user) return fail(403, "human_approval_required", "Only a signed-in OCC operator can approve or reject creative.");
  const editable = ["request_id","ad_group_name","destination_url","utm_source","utm_medium","utm_campaign","primary_text","cta","sitelink_text","sitelink_description_1","sitelink_description_2","callout_text","snippet_header","notes","format_ratio"];
  const payload: Record<string, unknown> = { workflow_state: nextState, ...Object.fromEntries(editable.filter((key) => body[key] !== undefined).map((key) => [key, body[key]])) };
  const hasEdit = editable.some((key) => body[key] !== undefined) || body.variants !== undefined;
  if (hasEdit) {
    if (!["draft", "rejected"].includes(current.workflow_state)) return fail(409, "immutable_in_review", "Only draft or rejected creative can be edited.");
    const variantInput = Array.isArray(body.variants) ? body.variants : [];
    const errors = validateCreative({ ...current, ...payload, variants: variantInput.length ? variantInput : [{ variant_type: current.asset_type === "structured_snippet" ? "snippet_value" : "headline" }] });
    if (errors.length) return fail(422, "validation_failed", errors.join(" "), { errors });
    if (variantInput.length) {
      const variants = variantInput.map((item, index) => { const value = item as Record<string, unknown>; return { creative_id: id, creative_version: Number(current.version) + 1, variant_type: value.variant_type, position: Number(value.position || index + 1), value: value.value, original_value: value.original_value ?? null, original_character_count: value.original_character_count ?? null, corrected_character_count: value.corrected_character_count ?? null, meaning_change_label: value.meaning_change_label ?? null }; });
      const { error: variantError } = await context.supabase.from("paid_media_creative_variants").insert(variants);
      if (variantError) return fail(409, "variant_write_failed", variantError.message);
    } else {
      const { data: priorVariants, error: priorError } = await context.supabase.from("paid_media_creative_variants").select("variant_type,position,value,original_value,original_character_count,corrected_character_count,meaning_change_label").eq("creative_id", id).eq("creative_version", current.version);
      if (priorError) return fail(409, "variant_read_failed", priorError.message);
      if (priorVariants?.length) await context.supabase.from("paid_media_creative_variants").insert(priorVariants.map((variant) => ({ ...variant, creative_id: id, creative_version: Number(current.version) + 1 })));
    }
  }
  if (!hasEdit) {
    const { data: priorVariants, error: priorError } = await context.supabase.from("paid_media_creative_variants").select("variant_type,position,value,original_value,original_character_count,corrected_character_count,meaning_change_label").eq("creative_id", id).eq("creative_version", current.version);
    if (priorError) return fail(409, "variant_read_failed", priorError.message);
    if (priorVariants?.length) await context.supabase.from("paid_media_creative_variants").insert(priorVariants.map((variant) => ({ ...variant, creative_id: id, creative_version: Number(current.version) + 1 })));
  }
  Object.assign(payload, context.user ? { last_changed_by: context.user.id, last_changed_by_agent_id: null } : { last_changed_by: null, last_changed_by_agent_id: context.agentId });
  if (nextState === "approved") Object.assign(payload, { approved_by: context.user!.id, approved_at: new Date().toISOString() });
  else Object.assign(payload, { approved_by: null, approved_at: null });
  const { data, error } = await context.supabase.from("paid_media_creatives").update(payload).eq("id", id).select().single();
  if (error || !data) {
    await context.supabase.from("paid_media_creative_variants").delete().eq("creative_id", id).eq("creative_version", Number(current.version) + 1);
    return fail(400, "write_failed", error?.message || "Creative could not be updated.");
  }
  return ok(data);
}

export const OPTIONS = preflight;
