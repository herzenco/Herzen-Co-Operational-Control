import { isApiError, requireMember } from "../../../../../../utils/api/auth";
import { fail, ok, preflight, readJson } from "../../../../../../utils/api/responses";

type RouteContext = { params: Promise<{ id: string }> };

const allowedFields = new Set(["idempotency_key"]);

export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const context = await requireMember(request, { write: true, allowAgentWrite: true });
  if (isApiError(context)) return context;
  if (!context.agentId || context.user || String(context.member.permissions.agent_code || "").toLowerCase() !== "lupe") {
    return fail(403, "lupe_machine_identity_required", "Only Lupe's authenticated machine identity can send editorial work to Tito.");
  }

  const body = await readJson(request);
  if (!body) return fail(400, "invalid_json", "Send a JSON request body.");
  const unexpected = Object.keys(body).filter((field) => !allowedFields.has(field));
  if (unexpected.length) return fail(400, "unsupported_fields", "Only idempotency_key is accepted.", { fields: unexpected });
  const idempotencyKey = String(body.idempotency_key || "").trim();
  if (!idempotencyKey) return fail(422, "idempotency_key_required", "An idempotency key is required.");

  const { data, error } = await context.supabase.rpc("send_monthly_content_to_tito", {
    target_content_item_id: id,
    requesting_agent_id: context.agentId,
    request_key: idempotencyKey,
  });
  if (error) {
    const message = error.message || "The editorial handoff to Tito could not be recorded.";
    if (message.includes("content_item_not_found")) return fail(404, "content_item_not_found", "The content item was not found.");
    if (message.includes("monthly_content_v2_required")) return fail(409, "monthly_content_v2_required", "Send to Tito is available only for Monthly Content Operations v2 items.");
    if (message.includes("content_item_not_ready_for_lupe")) return fail(409, "wrong_lifecycle_state", "The content item must be ready_for_lupe.");
    if (message.includes("monthly_content_owner_required") || message.includes("monthly_content_owner_inactive")) {
      return fail(422, "monthly_content_planning_incomplete", "An active content owner is required before Tito review.", { missing_fields: ["owner_agent_id"] });
    }
    if (message.includes("monthly_content_publish_at_required")) {
      return fail(422, "monthly_content_planning_incomplete", "An intended publication time is required before Tito review.", { missing_fields: ["publish_at"] });
    }
    if (message.includes("current_anthropic_audit_required") || message.includes("current_anthropic_audit_not_passed")) {
      return fail(409, "passed_anthropic_audit_required", "The current durable revision must have a passed Anthropic audit.");
    }
    if (message.includes("active_lupe_review_work_item_required")) return fail(409, "active_lupe_review_required", "An active Lupe review work item is required.");
    if (message.includes("idempotency_key_conflict")) return fail(409, "idempotency_key_conflict", "That idempotency key conflicts with another handoff context.");
    if (message.includes("pending_tito_approval_conflict") || message.includes("content_item_approval_state_inconsistent")) {
      return fail(409, "approval_state_inconsistent", "The content item already has inconsistent or unrelated approval state.");
    }
    if (message.includes("revision") || message.includes("review_package") || message.includes("source_asset") || message.includes("delivery_asset") || message.includes("lupe_work_item_package_mismatch")) {
      return fail(409, "review_package_inconsistent", "The current revision, review package, assets, and Lupe work item must agree.");
    }
    return fail(400, "send_to_tito_failed", message);
  }
  return ok(data);
}

export const OPTIONS = preflight;
