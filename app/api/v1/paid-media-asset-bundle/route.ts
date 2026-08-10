import { isApiError, requireMember } from "../../../../utils/api/auth";
import { fail, ok, preflight } from "../../../../utils/api/responses";

export async function GET(request: Request) {
  const context = await requireMember(request);
  if (isApiError(context)) return context;
  const url = new URL(request.url);
  const campaignId = url.searchParams.get("campaign_id");
  const campaignName = url.searchParams.get("campaign_name");
  const workItemId = url.searchParams.get("work_item_id");
  if (!campaignId && !campaignName && !workItemId) return fail(400, "scope_required", "Provide campaign_id, campaign_name, or work_item_id.");
  let query = context.supabase.from("approved_paid_media_asset_bundle").select("*");
  if (campaignId) query = query.eq("campaign_id", campaignId);
  if (campaignName) query = query.eq("campaign_name", campaignName);
  if (workItemId) query = query.eq("work_item_id", workItemId);
  const { data, error } = await query.order("approved_at", { ascending: true });
  if (error) return fail(500, "database_error", error.message);
  return ok({ approved_only: true, buildable: true, asset_count: data?.length || 0, assets: data || [] });
}

export const OPTIONS = preflight;
