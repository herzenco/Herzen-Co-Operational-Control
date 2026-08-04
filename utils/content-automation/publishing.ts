import type { SupabaseClient } from "@supabase/supabase-js";

export async function publishContent(supabase: SupabaseClient, item: Record<string, unknown>, platform: "website" | "linkedin") {
  const endpoint = platform === "website" ? process.env.HERZEN_WEBSITE_PUBLISH_URL : process.env.LUPE_LINKEDIN_PUBLISH_URL;
  if (!endpoint) throw new Error(`${platform} publishing endpoint is not configured.`);
  const webhookSecret = platform === "website"
    ? process.env.WEBSITE_PUBLISHING_WEBHOOK_SECRET || process.env.PUBLISHING_WEBHOOK_SECRET
    : process.env.LINKEDIN_PUBLISHING_WEBHOOK_SECRET || process.env.PUBLISHING_WEBHOOK_SECRET;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(webhookSecret ? { Authorization: `Bearer ${webhookSecret}` } : {}),
    },
    body: JSON.stringify({
      content_item_id: item.id,
      title: item.title,
      body: item.body,
      caption: item.caption,
      slug: item.slug,
      meta_description: item.meta_description,
      publish_at: item.publish_at,
      final_url: item.final_url,
      seo_score: item.seo_score,
      aeo_score: item.aeo_score,
    }),
  });
  if (!response.ok) {
    const providerMessage = (await response.text()).slice(0, 500);
    throw new Error(`${platform} publishing failed (${response.status}): ${providerMessage}`);
  }
  const result = await response.json() as { url?: string; final_url?: string; id?: string };
  const finalUrl = result.final_url || result.url;
  if (!finalUrl) throw new Error(`${platform} publishing did not return a canonical URL.`);
  const { error } = await supabase.from("content_items").update({ status: "published", publication_state: "published", final_url: finalUrl, published_at: new Date().toISOString(), external_job_id: result.id || null, external_status: "published" }).eq("id", item.id);
  if (error) throw error;
  if (platform === "website" && item.paired_content_item_id) {
    const { data: companion, error: companionError } = await supabase.from("content_items").select("id,body,caption,metadata").eq("id", item.paired_content_item_id).single();
    if (companionError) throw companionError;
    const priorMetadata = (companion.metadata || {}) as Record<string, unknown>;
    const priorUrl = String(priorMetadata.planned_website_url || priorMetadata.website_url || "");
    const metadata = { ...priorMetadata, website_url: finalUrl };
    const replaceUrl = (value: unknown) => priorUrl ? String(value || "").replaceAll(priorUrl, finalUrl) : String(value || "");
    const { error: syncError } = await supabase.from("content_items").update({ metadata, body: replaceUrl(companion.body), caption: replaceUrl(companion.caption) }).eq("id", companion.id);
    if (syncError) throw syncError;
  }
  return finalUrl;
}
