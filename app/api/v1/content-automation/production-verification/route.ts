import { NextResponse } from "next/server";
import { isApiError, requireMember } from "@/utils/api/auth";
import { automationErrorMessage, executeAutomationJob, executeWhatsAppCanary } from "@/utils/content-automation/runner";
import { createAutomationClient } from "@/utils/content-automation/server";

const GENERATION_KEY = "occ-production-generation-canary-2026-08-07";
const WHATSAPP_KEY = "occ-production-whatsapp-canary-2026-08-07";

export async function POST(request: Request) {
  const context = await requireMember(request, { write: true });
  if (isApiError(context)) return context;
  if (process.env.CONTENT_AUTOMATION_ENABLED === "true") {
    return NextResponse.json({ error: { message: "Production verification requires automation to remain disabled." } }, { status: 409 });
  }
  const body = await request.json().catch(() => ({})) as { operation?: string };
  const requestId = request.headers.get("idempotency-key")?.trim() || "";
  try {
    if (body.operation === "generation" && requestId === GENERATION_KEY) {
      const result = await executeAutomationJob(createAutomationClient(), "monthly_generation", {
        requestId,
        triggerSource: "manual",
        configuration: { generation_only_canary: true, pair_limit: 1, allow_evergreen_fallback: true },
      });
      return NextResponse.json({ data: result }, { status: 202 });
    }
    if (body.operation === "whatsapp" && requestId === WHATSAPP_KEY) {
      const result = await executeWhatsAppCanary(createAutomationClient(), requestId);
      return NextResponse.json({ data: result }, { status: 202 });
    }
    return NextResponse.json({ error: { message: "The fixed production-verification identity is required." } }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: { message: automationErrorMessage(error) } }, { status: 500 });
  }
}
