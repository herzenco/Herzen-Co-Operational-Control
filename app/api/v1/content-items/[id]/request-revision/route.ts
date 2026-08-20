import { isApiError, requireMember } from "../../../../../../utils/api/auth";
import { fail, ok, preflight, readJson } from "../../../../../../utils/api/responses";

type RouteContext = { params: Promise<{ id: string }> };

const allowedFields = new Set(["feedback", "idempotency_key"]);

export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const context = await requireMember(request, { write: true, allowAgentWrite: true });
  if (isApiError(context)) return context;
  if (!context.agentId || context.user || String(context.member.permissions.agent_code || "").toLowerCase() !== "lupe") {
    return fail(403, "lupe_machine_identity_required", "Only Lupe's authenticated machine identity can request editorial revision.");
  }

  const body = await readJson(request);
  if (!body) return fail(400, "invalid_json", "Send a JSON request body.");
  const unexpected = Object.keys(body).filter((field) => !allowedFields.has(field));
  if (unexpected.length) return fail(400, "unsupported_fields", "Only feedback and idempotency_key are accepted.", { fields: unexpected });
  const feedback = String(body.feedback || "").trim();
  const idempotencyKey = String(body.idempotency_key || "").trim();
  if (!feedback) return fail(422, "review_feedback_required", "Written Lupe review feedback is required.");
  if (!idempotencyKey) return fail(422, "idempotency_key_required", "An idempotency key is required.");

  const { data, error } = await context.supabase.rpc("request_monthly_content_revision", {
    target_content_item_id: id,
    requesting_agent_id: context.agentId,
    review_feedback: feedback,
    request_key: idempotencyKey,
  });
  if (error) {
    const message = error.message || "Lupe's revision request could not be recorded.";
    if (message.includes("content_item_not_found")) return fail(404, "content_item_not_found", "The content item was not found.");
    if (message.includes("content_item_not_ready_for_lupe")) return fail(409, "wrong_lifecycle_state", "The content item must be ready_for_lupe.");
    if (message.includes("active_lupe_review_work_item_required")) return fail(409, "active_lupe_review_required", "An active Lupe review work item is required.");
    if (message.includes("idempotency_key_conflict")) return fail(409, "idempotency_key_conflict", "That idempotency key was already used with different feedback.");
    return fail(400, "request_revision_failed", message);
  }
  return ok(data);
}

export const OPTIONS = preflight;
