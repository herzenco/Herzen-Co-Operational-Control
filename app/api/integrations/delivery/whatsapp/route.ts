import { z } from "zod";
import { hasWebhookBearer } from "@/utils/integrations/webhook-auth";

export const runtime = "nodejs";

const payloadSchema = z.object({
  type: z.enum(["weekly_review_pack", "publish_day_notice", "lupe_check_in"]),
  mode: z.enum(["final_checkpoint", "heads_up"]).optional(),
  items: z.array(z.object({
    title: z.string().trim().min(1).max(240),
    review_url: z.string().url().max(2_000),
  })).min(1).max(20),
});

export async function POST(request: Request) {
  if (!hasWebhookBearer(request, process.env.LUPE_DELIVERY_WEBHOOK_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = payloadSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_request", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const recipient = process.env.LUPE_WHATSAPP_TO?.trim();
  const apiVersion = process.env.WHATSAPP_API_VERSION?.trim();
  if (!accessToken || !phoneNumberId || !recipient || !/^v\d+\.\d+$/.test(apiVersion || "")) {
    return Response.json(
      { error: "whatsapp_not_configured" },
      { status: 503 },
    );
  }

  const message = formatMessage(parsed.data);
  const response = await fetch(
    `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(phoneNumberId)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient,
        type: "text",
        text: { preview_url: true, body: message },
      }),
    },
  );

  if (!response.ok) {
    const providerMessage = (await response.text()).slice(0, 500);
    console.error("WhatsApp delivery failed", response.status, providerMessage);
    return Response.json(
      { error: "whatsapp_delivery_failed", provider_status: response.status },
      { status: 502 },
    );
  }

  const provider = await response.json() as {
    messages?: Array<{ id?: string }>;
  };
  return Response.json({
    delivered: true,
    id: provider.messages?.[0]?.id || null,
    item_count: parsed.data.items.length,
  });
}

function formatMessage(payload: z.infer<typeof payloadSchema>) {
  const heading = payload.type === "weekly_review_pack"
    ? "OCC weekly review pack"
    : payload.type === "publish_day_notice"
      ? payload.mode === "heads_up"
        ? "OCC publishing today — approved"
        : "OCC final approval checkpoint"
      : "OCC automation check-in";
  const items = payload.items.map(
    (item, index) => `${index + 1}. ${item.title}\n${item.review_url}`,
  );
  return [heading, ...items].join("\n\n").slice(0, 4_096);
}

async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
