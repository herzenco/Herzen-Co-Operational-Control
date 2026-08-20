import { disabledAutomationResult } from "@/utils/content-automation/retirement";
import { hasWebhookBearer } from "@/utils/integrations/webhook-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasWebhookBearer(request, process.env.LUPE_DELIVERY_WEBHOOK_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  return Response.json({ error: disabledAutomationResult("whatsapp_delivery") }, { status: 410 });
}
