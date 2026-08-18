import { fail, ok, preflight } from "../../../../utils/api/responses";
import { createAutomationClient } from "../../../../utils/content-automation/server";
import { bearerToken, HERZENCO_OCC_PROPERTY, HERZENCO_PUBLIC_PROPERTY, isPublishedHerzencoBlog, serializePublishedArticle, tokensMatch, validatePublishedArticle } from "../../../../utils/content-publishing/herzenco";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!tokensMatch(bearerToken(request), process.env.HERZENCO_CONTENT_API_TOKEN)) {
    return fail(401, "unauthorized", "A valid server content token is required.");
  }
  const url = new URL(request.url);
  if (url.searchParams.get("property") !== HERZENCO_PUBLIC_PROPERTY || url.searchParams.get("status") !== "published") {
    return fail(400, "invalid_scope", "Use property=herzenco&status=published.");
  }
  const supabase = createAutomationClient();
  const { data, error } = await supabase
    .from("content_items")
    .select("id,title,brief,body,slug,seo_title,meta_description,status,publication_state,published_at,updated_at,final_url,metadata,property:content_properties!inner(slug),channel:content_channels!inner(platform),content_type:content_types(slug),content_assets!content_assets_content_item_id_fkey(asset_role,is_current,external_url,metadata)")
    .eq("property.slug", HERZENCO_OCC_PROPERTY)
    .eq("channel.platform", "website")
    .eq("status", "published")
    .eq("publication_state", "published")
    .order("published_at", { ascending: false });
  if (error) {
    console.error("Herzenco published-content query failed.", { code: error.code, message: error.message, hint: error.hint });
    return fail(500, "database_error", "Published content could not be retrieved.");
  }
  const articles = (data || []).filter(isPublishedHerzencoBlog).map(serializePublishedArticle);
  const invalid = articles.find((article) => validatePublishedArticle(article).length);
  if (invalid) return fail(500, "invalid_published_record", "A published article is missing required public fields.");
  return ok(articles);
}

export const OPTIONS = preflight;
