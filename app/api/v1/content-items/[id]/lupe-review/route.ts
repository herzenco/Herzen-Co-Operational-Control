import { isApiError, requireMember } from "../../../../../../utils/api/auth";
import { fail, ok, readJson } from "../../../../../../utils/api/responses";

type RouteContext = { params: Promise<{ id: string }> };

const actions = new Set(["acceptance_passed", "acceptance_failed", "tito_approval_observed", "tito_rejection_observed"]);

export async function POST(request: Request, { params }: RouteContext) {
  const context = await requireMember(request, { write: true, allowAgentWrite: true });
  if (isApiError(context)) return context;
  if (context.member.role !== "agent" || String(context.member.permissions.agent_code || "").toLowerCase() !== "lupe") {
    return fail(403, "lupe_machine_auth_required", "This operational observation must be recorded by Lupe's scoped machine credential.");
  }
  const { id } = await params;
  const body = await readJson(request);
  const action = String(body?.action || "");
  const idempotencyKey = String(body?.idempotency_key || "").trim();
  const note = String(body?.note || "").trim();
  if (!actions.has(action) || !idempotencyKey) return fail(422, "invalid_lupe_review", "A supported action and idempotency_key are required.");
  const { data: item, error: itemError } = await context.supabase.from("content_items").select("id,metadata,approval_id").eq("id", id).single();
  if (itemError || !item) return fail(404, "not_found", "The shadow content item was not found.");
  if (item.metadata?.monthly_content_operations_shadow !== true) return fail(409, "shadow_item_required", "Lupe's readiness observation route is limited to Monthly Content Operations shadow items.");

  if (action.startsWith("tito_")) {
    const expected = action === "tito_approval_observed" ? "approved" : "declined";
    if (!item.approval_id) return fail(409, "authoritative_decision_missing", "No authoritative Tito approval record exists for this item. Lupe cannot create one.");
    const { data: approval } = await context.supabase.from("approvals").select("status").eq("id", item.approval_id).single();
    if (approval?.status !== expected) return fail(409, "authoritative_decision_mismatch", `The OCC approval record is not ${expected}. Lupe cannot change the decision.`);
  }

  const comment = action === "acceptance_passed"
    ? `Lupe acceptance test passed.${note ? ` ${note}` : ""}`
    : action === "acceptance_failed"
      ? `Lupe acceptance test failed.${note ? ` ${note}` : ""}`
      : action === "tito_approval_observed"
        ? "Lupe recorded the existing authoritative Tito approval."
        : "Lupe recorded the existing authoritative Tito rejection.";
  const { data: inserted, error } = await context.supabase.from("content_review_events").upsert({
    content_item_id: id,
    event_type: action.startsWith("acceptance_") ? "triaged" : "commented",
    comment,
    reviewer_name: "Lupe",
    triaged_by_agent_id: context.agentId,
    idempotency_key: idempotencyKey,
  }, { onConflict: "idempotency_key", ignoreDuplicates: true }).select("id,event_type,created_at").maybeSingle();
  if (error) return fail(409, "observation_failed", error.message);
  if (inserted) return ok({ ...inserted, duplicate: false });
  const { data: existing, error: existingError } = await context.supabase.from("content_review_events").select("id,event_type,created_at").eq("idempotency_key", idempotencyKey).single();
  if (existingError || !existing) return fail(409, "observation_reload_failed", existingError?.message || "The idempotent observation could not be reloaded.");
  return ok({ ...existing, duplicate: true });
}
