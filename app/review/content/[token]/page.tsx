import { notFound } from "next/navigation";
import { resolveReviewLink } from "../../../../utils/content-automation/review-links";
import { createAutomationClient } from "../../../../utils/content-automation/server";

export default async function ContentReviewPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ submitted?: string }> }) {
  const { token } = await params;
  const { submitted } = await searchParams;
  const supabase = createAutomationClient();
  const link = await resolveReviewLink(supabase, token);
  if (!link) notFound();
  const { data: item } = await supabase.from("content_items").select("id,title,body,caption,status,publish_at,target_audience,conversion_goal,seo_title,meta_description,reasoning_summary,source_links,seo_score,aeo_score,audit_summary,audit_blockers,metadata").eq("id", link.content_item_id).single();
  if (!item) notFound();
  const role = (item.metadata as Record<string, unknown> | null)?.content_role === "blog" ? "Website blog" : "LinkedIn post";
  return <main className="publicReviewPage">
    <article className="publicReviewCard">
      <header><span>Herzen Co. content review</span><h1>{item.title}</h1><p>{role} · {item.publish_at ? new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "America/New_York" }).format(new Date(item.publish_at)) : "Unscheduled"}</p></header>
      {submitted && <div className="reviewSubmitted">Your {submitted.replaceAll("_", " ")} response was recorded.</div>}
      <section className="reviewScoreDeck"><div><b>{item.seo_score}</b><span>SEO</span></div><div><b>{item.aeo_score}</b><span>AEO</span></div></section>
      <section className="reviewArticle">{role === "LinkedIn post" ? <p>{item.caption || item.body}</p> : String(item.body || "").split("\n").filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</section>
      <dl className="reviewFacts"><div><dt>Audience</dt><dd>{item.target_audience || "Not documented"}</dd></div><div><dt>Goal</dt><dd>{item.conversion_goal || "Not documented"}</dd></div><div><dt>Audit</dt><dd>{item.audit_summary || "Passed automated review"}</dd></div></dl>
      <form className="publicReviewForm" method="post" action="/api/review/content">
        <input type="hidden" name="token" value={token} />
        <label>Your name<input name="reviewer_name" required /></label><label>Email<input name="reviewer_email" type="email" /></label>
        <label>Comment<textarea name="comment" placeholder="Required for changes, decline, or comment-only feedback." /></label>
        <div><button name="action" value="declined" className="outlineBtn">Decline</button><button name="action" value="changes_requested" className="outlineBtn">Request changes</button><button name="action" value="commented" className="outlineBtn">Comment</button><button name="action" value="approved" className="liveBtn">Approve</button></div>
      </form>
    </article>
  </main>;
}

