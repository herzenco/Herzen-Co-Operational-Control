import type { SupabaseClient } from "@supabase/supabase-js";

export async function publishContent(supabase: SupabaseClient, item: Record<string, unknown>, platform: "website" | "linkedin") {
  const endpoint = platform === "website" ? process.env.HERZEN_WEBSITE_PUBLISH_URL : process.env.LUPE_LINKEDIN_PUBLISH_URL;
  if (!endpoint) throw new Error(`${platform} publishing endpoint is not configured.`);
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", ...(process.env.PUBLISHING_WEBHOOK_SECRET ? { Authorization: `Bearer ${process.env.PUBLISHING_WEBHOOK_SECRET}` } : {}) }, body: JSON.stringify({ content_item_id: item.id, title: item.title, body: item.body, caption: item.caption, slug: item.slug, meta_description: item.meta_description, publish_at: item.publish_at, final_url: item.final_url }) });
  if (!response.ok) throw new Error(`${platform} publishing failed (${response.status}).`);
  const result = await response.json() as { url?: string; final_url?: string; id?: string };
  const finalUrl = result.final_url || result.url;
  if (!finalUrl) throw new Error(`${platform} publishing did not return a canonical URL.`);
  const { error } = await supabase.from("content_items").update({ status: "published", publication_state: "published", final_url: finalUrl, published_at: new Date().toISOString(), external_job_id: result.id || null, external_status: "published" }).eq("id", item.id);
  if (error) throw error;
  return finalUrl;
}

