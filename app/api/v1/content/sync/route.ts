import { isApiError, requireMember } from "../../../../../utils/api/auth";
import { fail, ok } from "../../../../../utils/api/responses";
import { HERZENCO_OCC_PROPERTY } from "../../../../../utils/content-publishing/herzenco";
import { isPublishedHerzencoBlog } from "../../../../../utils/content-publishing/herzenco";

export async function POST(request: Request) {
  const context = await requireMember(request, { write: true });
  if (isApiError(context)) return context;
  const { data: property, error: propertyError } = await context.supabase.from("content_properties").select("id").eq("slug", HERZENCO_OCC_PROPERTY).single();
  if (propertyError || !property) return fail(500, "property_lookup_failed", "The Herzen Co. property could not be resolved.");
  const { data: items, error } = await context.supabase.from("content_items")
    .select("id,slug,status,publication_state,metadata,property:content_properties!inner(slug),channel:content_channels!inner(platform),content_type:content_types(slug)")
    .eq("property_id", property.id).eq("channel.platform", "website").eq("status", "published").eq("publication_state", "published");
  if (error) return fail(500, "database_error", "Published content could not be queued for synchronization.");
  const events = (items || []).filter(isPublishedHerzencoBlog).map((item) => ({ event: "content.updated", property: "herzenco", content_id: item.id, slug: item.slug, source: "manual_sync" }));
  if (events.length) {
    const inserted = await context.supabase.from("website_publication_events").insert(events);
    if (inserted.error) return fail(500, "queue_failed", "Website synchronization could not be queued.");
  }
  return ok({ queued: events.length }, { status: 202 });
}
