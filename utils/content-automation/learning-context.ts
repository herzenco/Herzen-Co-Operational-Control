import type { SupabaseClient } from "@supabase/supabase-js";

export async function loadLearningContext(supabase: SupabaseClient, propertyId: string) {
  const { data: items, error: itemError } = await supabase.from("content_items").select("id,title,body,caption,status,audit_summary,audit_blockers,seo_score,aeo_score,approved_at").eq("property_id", propertyId).in("status", ["approved","published","revision_required","recovery_required"]).order("updated_at", { ascending: false }).limit(40);
  if (itemError) throw itemError;
  const ids = (items || []).map((item) => item.id);
  const [{ data: reviews, error: reviewError }, { data: audits, error: auditError }] = ids.length ? await Promise.all([
    supabase.from("content_review_events").select("content_item_id,event_type,comment,created_at").in("content_item_id", ids).order("created_at", { ascending: false }).limit(100),
    supabase.from("content_audits").select("content_item_id,seo_score,aeo_score,summary,blockers,rewrite_guidance,created_at").in("content_item_id", ids).order("created_at", { ascending: false }).limit(100),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  if (reviewError) throw reviewError;
  if (auditError) throw auditError;
  return { prior_assets: items || [], review_history: reviews || [], audit_history: audits || [] };
}
