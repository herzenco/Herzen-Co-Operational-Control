import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizedWebhookFailure, sendHerzencoWebhook, webhookBackoffMs } from "./herzenco";

type EventRow = { id: string; event_id: string; event: string; property: string; content_id: string; slug: string; occurred_at: string; attempt: number; max_attempts: number };

export async function dispatchHerzencoEvents(supabase: SupabaseClient, now = new Date()) {
  const { data, error } = await supabase.from("website_publication_events").select("id,event_id,event,property,content_id,slug,occurred_at,attempt,max_attempts").in("status", ["queued", "failed"]).lte("next_attempt_at", now.toISOString()).order("occurred_at").limit(10);
  if (error) throw error;
  const results = [];
  for (const event of (data || []) as EventRow[]) {
    const attempt = Number(event.attempt) + 1;
    const claimed = await supabase.from("website_publication_events").update({ status: "sending", attempt, last_attempt_at: now.toISOString() }).eq("id", event.id).in("status", ["queued", "failed"]).select("id").maybeSingle();
    if (!claimed.data) continue;
    const payload = { event_id: event.event_id, event: event.event, property: event.property, content_id: event.content_id, slug: event.slug, occurred_at: event.occurred_at };
    const sent = await sendHerzencoWebhook(payload);
    if (sent.ok) {
      await supabase.from("website_publication_events").update({ status: "delivered", response_status: sent.status, delivered_at: new Date().toISOString(), failure_details: {} }).eq("id", event.id);
    } else {
      const retryable = sent.retryable && attempt < event.max_attempts;
      await supabase.from("website_publication_events").update({ status: "failed", response_status: sent.status, next_attempt_at: retryable ? new Date(now.valueOf() + webhookBackoffMs(attempt)).toISOString() : null, failure_details: sanitizedWebhookFailure(sent.error, sent.status) }).eq("id", event.id);
    }
    results.push({ event_id: event.event_id, attempt, delivered: sent.ok, retryable: !sent.ok && sent.retryable && attempt < event.max_attempts });
  }
  return results;
}
