import { notFound } from "next/navigation";
import { resolveReviewLink } from "../../../../utils/content-automation/review-links";
import { createAutomationClient } from "../../../../utils/content-automation/server";

export default async function ContentReviewPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ submitted?: string; error?: string }> }) {
  const { token } = await params;
  const { submitted, error } = await searchParams;
  const supabase = createAutomationClient();
  const link = await resolveReviewLink(supabase, token);
  if (!link) notFound();
  const [{ data: item }, { data: audits }, { data: events }] = await Promise.all([
    supabase.from("content_items").select("id,title,body,caption,status,publish_at,target_audience,conversion_goal,seo_title,meta_description,reasoning_summary,source_links,seo_score,aeo_score,audit_summary,audit_blockers,metadata,posting_instructions,package_manifest,qa_checklist,approval_state").eq("id", link.content_item_id).single(),
    supabase.from("content_audits").select("iteration,provider,seo_score,aeo_score,passed,summary,created_at").eq("content_item_id", link.content_item_id).order("iteration", { ascending: false }),
    supabase.from("content_review_events").select("event_type,comment,reviewer_name,created_at").eq("content_item_id", link.content_item_id).order("created_at", { ascending: false }),
  ]);
  if (!item) notFound();
  const role = (item.metadata as Record<string, unknown> | null)?.content_role === "blog" ? "Website blog" : "LinkedIn post";
  return <main className="publicReviewPage">
    <article className="publicReviewCard">
      <header><span>Herzen Co. content review</span><h1>{item.title}</h1><p>{role} · {item.publish_at ? new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "America/New_York" }).format(new Date(item.publish_at)) : "Unscheduled"}</p></header>
      {submitted && <div className="reviewSubmitted">Your {submitted.replaceAll("_", " ")} response was recorded.</div>}
      {error && <div className="reviewSubmitted">Approval was not recorded: {error}</div>}
      <section className="reviewScoreDeck"><div><b>{item.seo_score}</b><span>SEO</span></div><div><b>{item.aeo_score}</b><span>AEO</span></div></section>
      <section className="reviewArticle">{role === "LinkedIn post" ? <p>{item.caption || item.body}</p> : String(item.body || "").split("\n").filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</section>
      <dl className="reviewFacts"><div><dt>Audience</dt><dd>{item.target_audience || "Not documented"}</dd></div><div><dt>Goal</dt><dd>{item.conversion_goal || "Not documented"}</dd></div><div><dt>Audit</dt><dd>{item.audit_summary || "Passed automated review"}</dd></div></dl>
      <section className="reviewArticle"><h2>Publishing package</h2><p>{item.posting_instructions}</p><p>Approval: {item.approval_state}</p><p>QA: {Object.values(item.qa_checklist || {}).every(Boolean) ? "All checks passed" : "Blocked"}</p></section>
      <section className="reviewArticle"><h2>Audit history</h2>{(audits || []).map((audit) => <p key={audit.iteration}>Iteration {audit.iteration} · {audit.provider} · SEO {audit.seo_score} / AEO {audit.aeo_score} · {audit.passed ? "passed" : "failed"}</p>)}</section>
      <section className="reviewArticle"><h2>Review history</h2>{events?.length ? events.map((event, index) => <p key={index}>{event.event_type.replaceAll("_", " ")} · {event.reviewer_name || "Reviewer"}{event.comment ? ` — ${event.comment}` : ""}</p>) : <p>No prior review activity.</p>}</section>
      <form className="publicReviewForm" method="post" action="/api/review/content">
        <input type="hidden" name="token" value={token} />
        <label>Your name<input name="reviewer_name" required /></label><label>Email<input name="reviewer_email" type="email" /></label>
        <label>Comment<textarea name="comment" placeholder="Required for changes, decline, or comment-only feedback." /></label>
        <div><button name="action" value="declined" className="outlineBtn">Decline</button><button name="action" value="changes_requested" className="outlineBtn">Request changes</button><button name="action" value="commented" className="outlineBtn">Comment</button><button name="action" value="approved" className="liveBtn">Approve</button></div>
      </form>
    </article>
  </main>;
}
