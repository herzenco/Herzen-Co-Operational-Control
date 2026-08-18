import { createHash, timingSafeEqual } from "node:crypto";

export const HERZENCO_PUBLIC_PROPERTY = "herzenco";
export const HERZENCO_OCC_PROPERTY = "herzen-co";

type Row = Record<string, unknown>;

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function iso(value: unknown) {
  const parsed = new Date(String(value || ""));
  return Number.isNaN(parsed.valueOf()) ? "" : parsed.toISOString();
}

export function bearerToken(request: Request) {
  const match = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

export function tokensMatch(provided: string, expected: string | undefined) {
  if (!provided || !expected) return false;
  const left = createHash("sha256").update(provided).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

export function isPublishedHerzencoBlog(row: Row) {
  const property = record(row.property || row.content_properties);
  const channel = record(row.channel || row.content_channels);
  const contentType = record(row.content_type || row.content_types);
  const role = text(record(row.metadata).content_role).toLowerCase();
  return text(property.slug) === HERZENCO_OCC_PROPERTY
    && text(channel.platform) === "website"
    && (role === "blog" || ["blog", "website-article"].includes(text(contentType.slug)))
    && text(row.status) === "published"
    && text(row.publication_state) === "published";
}

export function serializePublishedArticle(row: Row) {
  const metadata = record(row.metadata);
  const assets = Array.isArray(row.content_assets) ? row.content_assets.map(record) : [];
  const hero = assets.find((asset) => text(asset.asset_role) === "hero" && asset.is_current !== false);
  const heroMetadata = record(hero?.metadata);
  const result: Row = {
    id: text(row.id),
    property: HERZENCO_PUBLIC_PROPERTY,
    status: "published",
    slug: text(row.slug),
    title: text(row.title),
    excerpt: text(metadata.excerpt) || text(row.brief),
    body: text(row.body),
    published_at: iso(row.published_at),
    updated_at: iso(row.updated_at),
  };
  const seoTitle = text(row.seo_title);
  const seoDescription = text(row.meta_description);
  if (seoTitle || seoDescription) result.seo = { ...(seoTitle ? { title: seoTitle } : {}), ...(seoDescription ? { description: seoDescription } : {}) };
  const heroUrl = text(hero?.external_url);
  const heroAlt = text(heroMetadata.alt);
  if (heroUrl) result.hero_image = { url: heroUrl, ...(heroAlt ? { alt: heroAlt } : {}) };
  const optional = {
    canonical_url: text(row.final_url),
    author: text(metadata.author),
    category: text(metadata.category) || (Array.isArray(metadata.categories) ? text(metadata.categories[0]) : ""),
  };
  for (const [key, value] of Object.entries(optional)) if (value) result[key] = value;
  return result;
}

export function validatePublishedArticle(article: Row) {
  return ["id", "property", "status", "slug", "title", "excerpt", "body", "published_at", "updated_at"]
    .filter((field) => !text(article[field]));
}

export function shouldRetryWebhook(status: number | null) {
  return status === null || status === 429 || status >= 500;
}

export function webhookBackoffMs(attempt: number) {
  return Math.min(60 * 60_000, 30_000 * (2 ** Math.max(0, attempt - 1)));
}

export function sanitizedWebhookFailure(error: unknown, status: number | null) {
  const category = status === null ? "network_error" : `http_${status}`;
  const name = error instanceof Error ? error.name : "WebhookError";
  return { category, error_name: name.slice(0, 80) };
}

export type WebhookSendResult = { ok: boolean; status: number | null; retryable: boolean; error?: unknown };

export async function sendHerzencoWebhook(payload: Row, options: { url?: string; secret?: string; timeoutMs?: number } = {}): Promise<WebhookSendResult> {
  const url = options.url || process.env.HERZENCO_PUBLISH_WEBHOOK_URL;
  const secret = options.secret || process.env.HERZENCO_PUBLISH_WEBHOOK_SECRET;
  if (!url || !secret) throw new Error("Herzenco webhook URL and secret are required.");
  if (new URL(url).protocol !== "https:") throw new Error("Herzenco webhook URL must use HTTPS.");
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(options.timeoutMs || 10_000),
    });
    return { ok: response.ok, status: response.status, retryable: !response.ok && shouldRetryWebhook(response.status) };
  } catch (error) {
    return { ok: false, status: null, retryable: true, error };
  }
}
