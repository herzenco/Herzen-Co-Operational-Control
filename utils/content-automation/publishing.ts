import type { SupabaseClient } from "@supabase/supabase-js";

type DbRecord = Record<string, unknown>;

export class PublicationProviderError extends Error {
  responseStatus: number | null;
  responseBody: DbRecord;
  validationErrors: string[];
  retryable: boolean;

  constructor(message: string, options: { responseStatus?: number | null; responseBody?: DbRecord; validationErrors?: string[]; retryable?: boolean } = {}) {
    super(message);
    this.name = "PublicationProviderError";
    this.responseStatus = options.responseStatus ?? null;
    this.responseBody = options.responseBody || {};
    this.validationErrors = options.validationErrors || [];
    this.retryable = options.retryable ?? true;
  }
}

export type PublicationResult = {
  finalUrl: string;
  externalId: string | null;
  status: string;
  responseStatus: number;
  responseBody: DbRecord;
};

function record(value: unknown): DbRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as DbRecord : {};
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.map(String).map((entry) => entry.trim()).filter(Boolean) : [];
}

async function responseJson(response: Response): Promise<DbRecord> {
  const text = await response.text();
  if (!text) return {};
  try { return record(JSON.parse(text)); }
  catch { return { raw: text.slice(0, 2_000) }; }
}

export async function publishContent(supabase: SupabaseClient, job: DbRecord, item: DbRecord): Promise<PublicationResult> {
  const platform = String(job.platform) as "website" | "linkedin";
  const endpoint = platform === "website" ? process.env.HERZEN_WEBSITE_PUBLISH_URL : process.env.LUPE_LINKEDIN_PUBLISH_URL;
  if (!endpoint) throw new PublicationProviderError(`${platform} publishing endpoint is not configured.`, { retryable: false });
  const webhookSecret = platform === "website"
    ? process.env.WEBSITE_PUBLISHING_WEBHOOK_SECRET || process.env.PUBLISHING_WEBHOOK_SECRET
    : process.env.LINKEDIN_PUBLISHING_WEBHOOK_SECRET || process.env.PUBLISHING_WEBHOOK_SECRET;
  const approvedPayload = record(job.approved_payload);
  if (platform === "website") {
    if (!Object.keys(approvedPayload).length) throw new PublicationProviderError("The website publish job does not contain an approved snapshot.", { validationErrors: ["Re-approve this blog to freeze its final website package."], retryable: false });
    if (String(approvedPayload.approved_content_hash || "") !== String(job.approved_content_hash || "")) throw new PublicationProviderError("The approved website snapshot hash does not match its publish job.", { validationErrors: ["Re-approve this blog before publishing."], retryable: false });
    if (String(approvedPayload.content_item_id || "") !== String(item.id || "")) throw new PublicationProviderError("The approved website snapshot belongs to a different content item.", { validationErrors: ["Rebuild the publication job from the correct OCC record."], retryable: false });
  }
  const requestPayload = platform === "website" ? approvedPayload : {
    content_item_id: item.id,
    title: item.title,
    body: item.body,
    caption: item.caption,
    publish_at: item.publish_at,
  };
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(webhookSecret ? { Authorization: `Bearer ${webhookSecret}` } : {}),
        ...(job.idempotency_key ? { "Idempotency-Key": String(job.idempotency_key) } : {}),
      },
      body: JSON.stringify(requestPayload),
    });
  } catch (error) {
    throw new PublicationProviderError(error instanceof Error ? error.message : `${platform} publishing request failed.`, { retryable: true });
  }
  const result = await responseJson(response);
  if (!response.ok) {
    const validationErrors = stringList(result.validation_errors).length
      ? stringList(result.validation_errors)
      : Object.values(record(result.issues)).flatMap((value) => stringList(value));
    const message = String(result.message || result.error || `${platform} publishing failed (${response.status}).`);
    throw new PublicationProviderError(message, {
      responseStatus: response.status,
      responseBody: result,
      validationErrors,
      retryable: response.status === 408 || response.status === 409 || response.status === 425 || response.status === 429 || response.status >= 500,
    });
  }
  const finalUrl = String(result.final_url || result.url || "").trim();
  if (!finalUrl) throw new PublicationProviderError(`${platform} publishing did not return a canonical URL.`, { responseStatus: response.status, responseBody: result, retryable: false });
  const publishedAt = String(result.published_at || new Date().toISOString());
  const externalId = result.id ? String(result.id) : null;
  const publishingStatus = String(result.publishing_status || result.status || "published");
  const { error } = await supabase.from("content_items").update({ status: "published", publication_state: "published", final_url: finalUrl, published_at: publishedAt, external_job_id: externalId, external_status: publishingStatus, failure_message: null }).eq("id", item.id);
  if (error) throw error;
  if (platform === "website" && item.paired_content_item_id) {
    const { data: companion, error: companionError } = await supabase.from("content_items").select("id,body,caption,metadata,approval_state,status").eq("id", item.paired_content_item_id).single();
    if (companionError) throw companionError;
    if (companion.approval_state !== "approved" && !["scheduled", "publishing", "published"].includes(String(companion.status))) {
      const priorMetadata = record(companion.metadata);
      const priorUrl = String(priorMetadata.planned_website_url || priorMetadata.website_url || "");
      const metadata = { ...priorMetadata, website_url: finalUrl };
      const replaceUrl = (value: unknown) => priorUrl ? String(value || "").replaceAll(priorUrl, finalUrl) : String(value || "");
      const { error: syncError } = await supabase.from("content_items").update({ metadata, body: replaceUrl(companion.body), caption: replaceUrl(companion.caption) }).eq("id", companion.id);
      if (syncError) throw syncError;
    }
  }
  return { finalUrl, externalId, status: publishingStatus, responseStatus: response.status, responseBody: result };
}
