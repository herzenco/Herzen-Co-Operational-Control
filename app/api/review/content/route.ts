import { NextResponse } from "next/server";
import { resolveReviewLink } from "../../../../utils/content-automation/review-links";
import { createAutomationClient } from "../../../../utils/content-automation/server";

const actions = new Set(["approved","changes_requested","declined","commented"]);

export async function POST(request: Request) {
  const form = await request.formData();
  const token = String(form.get("token") || "");
  const action = String(form.get("action") || "");
  const comment = String(form.get("comment") || "").trim();
  const reviewerName = String(form.get("reviewer_name") || "Herzen reviewer").trim();
  const reviewerEmail = String(form.get("reviewer_email") || "").trim();
  if (!token || !actions.has(action)) return NextResponse.json({ error: "Invalid review submission." }, { status: 400 });
  if (["changes_requested","declined","commented"].includes(action) && !comment) return NextResponse.json({ error: "A comment is required for this action." }, { status: 400 });
  const supabase = createAutomationClient();
  const link = await resolveReviewLink(supabase, token);
  if (!link) return NextResponse.json({ error: "This review link is invalid or expired." }, { status: 404 });
  const { error: eventError } = await supabase.from("content_review_events").insert({ content_item_id: link.content_item_id, review_link_id: link.id, event_type: action, comment: comment || null, reviewer_name: reviewerName || null, reviewer_email: reviewerEmail || null });
  if (eventError) return NextResponse.json({ error: eventError.message }, { status: 500 });
  if (action !== "commented") {
    const { data: currentItem } = await supabase.from("content_items").select("id,approval_id,channel_id,publish_at").eq("id", link.content_item_id).single();
    const update = action === "approved"
      ? { status: "approved", approval_state: "approved", review_approved_at: new Date().toISOString(), review_approved_by: reviewerName || reviewerEmail || "Herzen reviewer" }
      : { status: action === "declined" ? "cancelled" : "revision_requested", approval_state: action === "declined" ? "declined" : "changes_requested" };
    const { error } = await supabase.from("content_items").update(update).eq("id", link.content_item_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (currentItem?.approval_id) {
      const { error: approvalError } = await supabase.from("approvals").update({ status: action, decision_note: comment || null, decided_at: new Date().toISOString() }).eq("id", currentItem.approval_id);
      if (approvalError) return NextResponse.json({ error: approvalError.message }, { status: 500 });
    }
    if (action === "approved") {
      const { data: channel } = currentItem ? await supabase.from("content_channels").select("platform").eq("id", currentItem.channel_id).single() : { data: null };
      if (currentItem && channel && ["website","linkedin"].includes(channel.platform)) {
        await supabase.from("content_publish_jobs").upsert({ content_item_id: currentItem.id, platform: channel.platform, status: "queued", scheduled_for: currentItem.publish_at || new Date().toISOString() }, { onConflict: "content_item_id" });
      }
    }
  }
  await supabase.from("content_review_links").update({ last_viewed_at: new Date().toISOString() }).eq("id", link.id);
  return NextResponse.redirect(new URL(`/review/content/${token}?submitted=${action}`, request.url), 303);
}
