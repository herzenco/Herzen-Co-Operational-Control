import { z } from "zod";
import { hasWebhookBearer } from "@/utils/integrations/webhook-auth";

export const runtime = "nodejs";

const payloadSchema = z.object({
  content_item_id: z.string().uuid(),
  title: z.string().trim().min(1).max(240),
  body: z.string().trim().max(3_000).nullable().optional(),
  caption: z.string().trim().max(3_000).nullable().optional(),
});

export async function POST(request: Request) {
  const webhookSecret =
    process.env.LINKEDIN_PUBLISHING_WEBHOOK_SECRET ||
    process.env.PUBLISHING_WEBHOOK_SECRET;
  if (!hasWebhookBearer(request, webhookSecret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = payloadSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_request", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const accessToken = process.env.LINKEDIN_ACCESS_TOKEN?.trim();
  const author = process.env.LINKEDIN_AUTHOR_URN?.trim();
  const apiVersion = process.env.LINKEDIN_API_VERSION?.trim();
  if (!accessToken || !author || !/^\d{6}$/.test(apiVersion || "")) {
    return Response.json(
      { error: "linkedin_not_configured" },
      { status: 503 },
    );
  }

  const commentary = parsed.data.caption || parsed.data.body;
  if (!commentary) {
    return Response.json({ error: "linkedin_copy_missing" }, { status: 400 });
  }

  const response = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Linkedin-Version": apiVersion!,
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify({
      author,
      commentary,
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    }),
  });

  if (!response.ok) {
    const providerMessage = (await response.text()).slice(0, 500);
    console.error("LinkedIn publication failed", response.status, providerMessage);
    return Response.json(
      { error: "linkedin_publish_failed", provider_status: response.status },
      { status: 502 },
    );
  }

  const postUrn = response.headers.get("x-restli-id")?.trim();
  if (!postUrn) {
    return Response.json(
      { error: "linkedin_post_id_missing" },
      { status: 502 },
    );
  }

  return Response.json({
    id: postUrn,
    final_url: `https://www.linkedin.com/feed/update/${postUrn}/`,
    source_content_item_id: parsed.data.content_item_id,
  });
}

async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
