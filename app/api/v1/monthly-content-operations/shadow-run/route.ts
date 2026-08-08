import { isApiError, requireMember } from "../../../../../utils/api/auth";
import { fail, ok, readJson } from "../../../../../utils/api/responses";
import { runMonthlyContentShadow, validateMonthlyShadowInput } from "../../../../../utils/content-automation/shadow";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (process.env.OCC_MONTHLY_CONTENT_SHADOW_ENABLED !== "true") return fail(409, "monthly_shadow_disabled", "Monthly Content Operations shadow generation is disabled.");
  const context = await requireMember(request, { write: true, allowAgentWrite: true });
  if (isApiError(context)) return context;
  if (context.member.role === "agent" && String(context.member.permissions.agent_code || "").toLowerCase() !== "lupe") return fail(403, "lupe_or_operator_required", "Only Lupe or a human OCC operator may start the manual shadow run.");
  const body = await readJson(request);
  const parsed = validateMonthlyShadowInput(body);
  if (!parsed.ok) return fail(422, "invalid_shadow_request", parsed.message);
  try {
    return ok(await runMonthlyContentShadow(context.supabase, parsed.input));
  } catch (failure) {
    return fail(409, "monthly_shadow_blocked", failure instanceof Error ? failure.message : "Monthly shadow generation failed.");
  }
}
