import { z } from "zod";
import { createAutomationClient } from "@/utils/content-automation/server";
import { hasMatchingSecret, hasValidMetaSignature } from "@/utils/integrations/meta-signature";

export const runtime = "nodejs";

const receiptSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(z.object({
    changes: z.array(z.object({
      value: z.object({
        statuses: z.array(z.object({
          id: z.string().trim().min(1),
          status: z.enum(["sent", "delivered", "read", "failed"]),
          timestamp: z.string().optional(),
          errors: z.array(z.object({
            code: z.number().optional(),
            title: z.string().max(240).optional(),
          }).passthrough()).optional(),
        })).optional(),
      }).passthrough(),
    }).passthrough()),
  }).passthrough()),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const suppliedToken = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge") || "";
  if (mode !== "subscribe" || !hasMatchingSecret(suppliedToken, process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) || !challenge) {
    return Response.json({ error: "webhook_verification_failed" }, { status: 403 });
  }
  return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!hasValidMetaSignature(rawBody, request.headers.get("x-hub-signature-256"), process.env.WHATSAPP_APP_SECRET)) {
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }

  let body: unknown;
  try { body = JSON.parse(rawBody); }
  catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = receiptSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_receipt" }, { status: 400 });

  const receipts = parsed.data.entry.flatMap((entry) => entry.changes)
    .flatMap((change) => change.value.statuses || []);
  const supabase = createAutomationClient();
  let matched = 0;
  for (const receipt of receipts) {
    const safeEvidence = {
      id: receipt.id,
      status: receipt.status,
      timestamp: receipt.timestamp || null,
      errors: (receipt.errors || []).map((error) => ({ code: error.code || null, title: error.title || null })),
      signature_verified: true,
    };
    const { data, error } = await supabase.rpc("record_content_delivery_receipt", {
      p_provider_message_id: receipt.id,
      p_provider_status: receipt.status,
      p_provider_response: safeEvidence,
    });
    if (error) return Response.json({ error: "receipt_persistence_failed" }, { status: 500 });
    if (data) matched += 1;
  }
  return Response.json({ received: true, matched, receipt_count: receipts.length });
}
